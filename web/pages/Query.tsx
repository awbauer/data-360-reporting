import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { findParams } from '@shared/sql';
import { analyzeQuery, withLimit } from '@shared/sqlcheck';
import type { ParamDef, ParamType } from '@shared/types';
import { api } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EstimateChip } from '../components/EstimateChip';
import { ParamForm } from '../components/ParamForm';
import { ProposeDialog } from '../components/ProposeDialog';
import { ResultChart } from '../components/ResultChart';
import { ResultsGrid } from '../components/ResultsGrid';
import { SqlEditor } from '../components/SqlEditor';
import { useWorkbench } from '../context';
import { fmtAgo, fmtMs, fmtNum } from '../lib/format';
import { scanLong } from '../lib/estimateText';
import { formatSql } from '../lib/formatSql';
import { useScanEstimate } from '../lib/useScanEstimate';
import { countCache, emptyTab, MAX_TABS, normalizeTabs, skipLimitWarning, tabStore, type TabData, type TabStore } from '../lib/storage';
import { MAX_IN_MEMORY, useQueryRunner } from '../lib/useQueryRunner';

export interface QueryNavState {
  sql: string;
  dataspace?: string;
  autorun?: boolean;
  paramDefs?: ParamDef[];
  params?: Record<string, string>;
}

/** Rows to ask for when adding a LIMIT on the user's behalf. */
const SAFE_LIMIT = 1000;

// ------------------------------------------------------------------ tab manager

/** Waits briefly for the user's tabs from the server, so edits never race the load. */
export function QueryPage() {
  const wb = useWorkbench();
  const user = wb.session.user?.email ?? '';
  const remote = useQuery({ queryKey: ['state', 'tabs'], queryFn: () => api.getState<TabStore>('tabs'), staleTime: Infinity, retry: 0 });
  if (remote.isLoading) return <div className="hint">Loading your tabs…</div>;
  const initial = normalizeTabs(remote.data?.value) ?? tabStore.load(user);
  return <QueryTabs user={user} initial={initial} />;
}

function QueryTabs({ user, initial }: { user: string; initial: TabStore }) {
  const wb = useWorkbench();
  const qc = useQueryClient();
  const location = useLocation();
  const [store, setStore] = useState(initial);
  const [autorun, setAutorun] = useState<string | null>(null);
  const handled = useRef<string | null>(null);

  // A query handed over from another page (library, history, explorer) opens in its own tab.
  useEffect(() => {
    const incoming = location.state as QueryNavState | null;
    if (!incoming?.sql || handled.current === location.key) return;
    handled.current = location.key;
    if (incoming.dataspace && incoming.dataspace !== wb.dataspace && wb.dataspaces.some((d) => d.name === incoming.dataspace)) {
      wb.setDataspace(incoming.dataspace);
    }
    setStore((s) => {
      // Reuse an untouched tab instead of piling up blank ones.
      const blank = s.tabs.find((t) => t.id === s.active && !t.sql.trim());
      const values: Record<string, string> = { ...(incoming.params ?? {}) };
      for (const d of incoming.paramDefs ?? []) if (values[d.name] === undefined && d.default !== undefined) values[d.name] = d.default;
      const init = { sql: incoming.sql, paramDefs: incoming.paramDefs ?? [], values };
      // A fresh id remounts the tab, so the editor picks up the new text.
      const tab = emptyTab(s.tabs, init);
      if (incoming.autorun) setAutorun(tab.id);
      if (blank) return { tabs: s.tabs.map((t) => (t.id === blank.id ? tab : t)), active: tab.id };
      if (s.tabs.length >= MAX_TABS) return { ...s, tabs: [...s.tabs.slice(1), tab], active: tab.id };
      return { tabs: [...s.tabs, tab], active: tab.id };
    });
  }, [location, wb]);

  // Keep a browser copy right away and the account copy shortly after typing stops.
  useEffect(() => {
    const local = setTimeout(() => tabStore.save(user, store), 300);
    const remote = setTimeout(() => {
      qc.setQueryData(['state', 'tabs'], { value: store, updatedAt: Date.now() });
      api.putState('tabs', store).catch((e: unknown) => console.warn('Could not save tabs to your account', e));
    }, 1500);
    return () => {
      clearTimeout(local);
      clearTimeout(remote);
    };
  }, [store, user, qc]);

  const patch = useCallback((id: string, p: Partial<TabData>) => {
    setStore((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  }, []);

  const add = () =>
    setStore((s) => {
      if (s.tabs.length >= MAX_TABS) return s;
      const tab = emptyTab(s.tabs);
      return { tabs: [...s.tabs, tab], active: tab.id };
    });

  const close = (id: string) =>
    setStore((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      const rest = s.tabs.filter((t) => t.id !== id);
      if (!rest.length) {
        const tab = emptyTab([]);
        return { tabs: [tab], active: tab.id };
      }
      return { tabs: rest, active: s.active === id ? rest[Math.max(0, i - 1)]!.id : s.active };
    });

  const title = (t: TabData) => {
    const name = analyzeQuery(t.sql).idents.find((i) => wb.byName.has(i));
    const label = name ? wb.byName.get(name)!.label : `Query ${t.n}`;
    return label.length > 22 ? `${label.slice(0, 21)}…` : label;
  };

  return (
    <div className="qpage">
      <div className="tabbar" role="tablist" aria-label="Query tabs">
        {store.tabs.map((t) => (
          <div key={t.id} className={`qtab-head${t.id === store.active ? ' active' : ''}`}>
            <button
              role="tab"
              aria-selected={t.id === store.active}
              className="qtab-name"
              onClick={() => setStore((s) => ({ ...s, active: t.id }))}
            >
              {title(t)}
            </button>
            <button className="qtab-close" aria-label={`Close ${title(t)}`} onClick={() => close(t.id)}>×</button>
          </div>
        ))}
        <button className="qtab-add" onClick={add} disabled={store.tabs.length >= MAX_TABS} title={store.tabs.length >= MAX_TABS ? `At most ${MAX_TABS} tabs` : 'New query tab'} aria-label="New query tab">+</button>
      </div>
      <div className="qpage-body">
        {store.tabs.map((t) => (
          <div key={t.id} hidden={t.id !== store.active} className="qtab-panel" role="tabpanel">
            <QueryTab
              tab={t}
              active={t.id === store.active}
              autorun={autorun === t.id}
              onAutoran={() => setAutorun(null)}
              onChange={(p) => patch(t.id, p)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- one tab

interface TabProps {
  tab: TabData;
  active: boolean;
  autorun: boolean;
  onAutoran: () => void;
  onChange: (p: Partial<TabData>) => void;
}

function QueryTab({ tab, active, autorun, onAutoran, onChange }: TabProps) {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const [sql, setSql] = useState(tab.sql);
  const [resetKey, setResetKey] = useState(0);
  const [defs, setDefs] = useState<Record<string, ParamDef>>(() => Object.fromEntries(tab.paramDefs.map((d) => [d.name, d])));
  const [values, setValues] = useState<Record<string, string>>(tab.values);
  const [propose, setPropose] = useState(false);
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [formatError, setFormatError] = useState<string | null>(null);
  const [guard, setGuard] = useState<{ selectStar: boolean; objects: { label: string; rows?: number; at?: string }[] } | null>(null);
  const [skipNext, setSkipNext] = useState(false);
  const names = useMemo(() => findParams(sql), [sql]);
  const paramDefs = useMemo<ParamDef[]>(() => names.map((n) => defs[n] ?? { name: n, type: 'string' }), [names, defs]);

  // The server records every run (History reads it back), so nothing to store here.
  const runner = useQueryRunner();
  const { estimate } = useScanEstimate(sql);
  const { state } = runner;

  // Seed a starter query once, when the tab opens empty and metadata arrives. Never again:
  // clearing the editor must not bring it back.
  const seeded = useRef(Boolean(tab.sql));
  useEffect(() => {
    if (!seeded.current && wb.objects.length) {
      seeded.current = true;
      const first = wb.objects.find((o) => o.kind === 'dmo') ?? wb.objects[0]!;
      setSql(`SELECT *\nFROM "${first.name}"\nLIMIT 100`);
      setResetKey((k) => k + 1);
    }
  }, [wb.objects]);

  // Report edits upward so the tab bar can title the tab and the set can be restored later.
  useEffect(() => {
    onChange({ sql, paramDefs, values });
    // Only edits should report; `onChange` changes identity on every render of the parent.
  }, [sql, paramDefs, values]);

  // Recorded with the run so the audit can total estimated usage. Only sent when there is something to go on.
  const est = estimate && (estimate.rows > 0 || estimate.complete) ? { estRows: estimate.rows, estComplete: estimate.complete } : {};
  const execute = useCallback(
    (text: string) => void runner.start({ sql: text, dataspace: wb.dataspace, paramDefs, params: values, ...est }),
    [runner, wb.dataspace, paramDefs, values, est.estRows, est.estComplete],
  );

  /** Run, but first ask if the query would read a whole object. */
  const requestRun = useCallback(() => {
    if (!sql.trim() || state.phase === 'running') return;
    const shape = analyzeQuery(sql);
    if (shape.unbounded && !skipLimitWarning.get()) {
      const objects = wb.objects
        .filter((o) => shape.idents.includes(o.name))
        .map((o) => {
          const c = countCache.get(host, wb.dataspace, o.name);
          return { label: o.label, rows: c?.rows, at: c?.at };
        });
      setGuard({ selectStar: shape.selectStar, objects });
      return;
    }
    execute(sql);
  }, [sql, state.phase, wb.objects, wb.dataspace, host, execute]);

  const runRef = useRef(requestRun);
  runRef.current = requestRun;

  const ran = useRef(false);
  useEffect(() => {
    if (autorun && !ran.current && sql) {
      ran.current = true;
      onAutoran();
      runRef.current();
    }
  }, [autorun, sql, onAutoran]);

  const closeGuard = () => {
    if (skipNext) skipLimitWarning.set(true);
    setGuard(null);
  };
  const runAnyway = () => {
    closeGuard();
    execute(sql);
  };
  const runLimited = () => {
    const limited = withLimit(sql, SAFE_LIMIT);
    closeGuard();
    setSql(limited);
    setResetKey((k) => k + 1);
    execute(limited);
  };

  const format = async () => {
    setFormatError(null);
    try {
      const out = await formatSql(sql);
      setSql(out);
      setResetKey((k) => k + 1);
    } catch (e) {
      setFormatError((e as Error).message);
    }
  };

  const running = state.phase === 'running';
  const canMore = state.phase === 'done' && state.rows.length < state.rowCount && state.rows.length < MAX_IN_MEMORY;
  const hasRows = state.columns.length > 0;

  return (
    <div
      className="qwrap"
      onKeyDown={(e) => {
        // The editor handles its own Mod+Enter (and marks it handled); this covers the param inputs.
        if (active && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) {
          e.preventDefault();
          runRef.current();
        }
      }}
    >
      <div className="toolbar">
        <button className="primary" onClick={requestRun} disabled={running || !sql.trim()} title="Ctrl/⌘ + Enter">▶ Run</button>
        <button onClick={runner.cancel} disabled={!running}>Cancel</button>
        <button onClick={() => void format()} disabled={!sql.trim()} title="Format SQL (Alt+Shift+F)">Format</button>
        <span className="muted small">Data space: <b>{wb.dataspace}</b></span>
        <div className="grow" />
        {state.queryId && state.phase === 'done' ? (
          <a href={api.exportUrl(state.queryId, state.dataspace, state.columns)} download>
            <button>Export CSV</button>
          </a>
        ) : <button disabled>Export CSV</button>}
        <button onClick={() => setPropose(true)} disabled={!sql.trim()}>Propose to library…</button>
      </div>

      <SqlEditor
        value={sql}
        resetKey={resetKey}
        onChange={setSql}
        onRun={() => runRef.current()}
        onFormat={() => void format()}
        visible={active}
        objects={wb.objects}
      />

      <div>
        {formatError && <div className="alert warn small" role="alert" style={{ margin: '6px 12px' }}>{formatError}</div>}
        <ParamForm
          names={names}
          defs={defs}
          values={values}
          onDef={(name, type: ParamType) => setDefs((d) => ({ ...d, [name]: { ...(d[name] ?? { name }), name, type } }))}
          onValue={(name, v) => setValues((x) => ({ ...x, [name]: v }))}
        />
        <div className="statusbar" role="status">
          {state.phase === 'idle' && <span>Ready. Press Ctrl/⌘ + Enter to run.</span>}
          {running && (
            <>
              <span>Running…</span>
              <span className="progress"><i style={{ width: `${Math.round(state.progress * 100)}%` }} /></span>
              {state.rowCount > 0 && <span>{fmtNum(state.rowCount)} rows so far</span>}
            </>
          )}
          {state.phase === 'cancelled' && <span>Cancelled.</span>}
          {state.phase === 'done' && (
            <span>
              {fmtNum(state.rowCount)} {state.rowCount === 1 ? 'row' : 'rows'}
              {state.rows.length < state.rowCount && ` (${fmtNum(state.rows.length)} loaded)`}
              {state.elapsedMs !== null && ` · ${fmtMs(state.elapsedMs)}`}
            </span>
          )}
          {state.phase === 'error' && <span style={{ color: 'var(--bad)' }}>Failed</span>}
          {canMore && <button className="link" onClick={() => void runner.loadMore()} disabled={state.loadingMore}>{state.loadingMore ? 'Loading…' : 'Load more rows'}</button>}
          {state.phase === 'done' && state.rows.length >= MAX_IN_MEMORY && state.rows.length < state.rowCount && <span>Display capped at {fmtNum(MAX_IN_MEMORY)} rows. Export CSV for the rest.</span>}
          <div className="grow" />
          {estimate && <EstimateChip estimate={estimate} />}
          {hasRows && (
            <span className="seg" role="group" aria-label="Result view">
              <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
              <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
            </span>
          )}
        </div>
      </div>

      <div className="results">
        {state.phase === 'error' && <div className="alert error" style={{ margin: 12, whiteSpace: 'pre-wrap' }} role="alert">{state.error}</div>}
        {hasRows && view === 'table' && <ResultsGrid columns={state.columns} rows={state.rows} />}
        {hasRows && view === 'chart' && (
          <ResultChart
            key={state.columns.map((c) => c.name).join('|')}
            columns={state.columns}
            rows={state.rows}
            partial={state.rows.length < state.rowCount}
          />
        )}
        {state.phase === 'done' && state.columns.length === 0 && <div className="hint">The query returned no columns.</div>}
      </div>

      <ConfirmDialog
        open={guard !== null}
        title="Run a query with no LIMIT?"
        confirmLabel={`Add LIMIT ${fmtNum(SAFE_LIMIT)} and run`}
        secondary={{ label: 'Run anyway', onClick: runAnyway }}
        onConfirm={runLimited}
        onCancel={() => setGuard(null)}
      >
        <p style={{ margin: 0 }}>
          This query reads {guard?.selectStar ? 'every column of every row' : 'every matching row'}
          {guard?.objects.length ? ' in:' : '.'} Only the first {fmtNum(1000)} rows are shown, but the whole scan still runs.
        </p>
        {guard && guard.objects.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {guard.objects.map((o) => (
              <li key={o.label}>
                <b>{o.label}</b>{' '}
                {o.rows !== undefined ? <span>≈ {fmtNum(o.rows)} rows <span className="muted small">(counted {fmtAgo(o.at!)})</span></span> : <span className="muted">row count unknown</span>}
              </li>
            ))}
          </ul>
        )}
        {estimate && <p className="small muted" style={{ margin: 0 }}>{scanLong(estimate)}</p>}
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 13 }}>
          <input type="checkbox" checked={skipNext} onChange={(e) => setSkipNext(e.target.checked)} style={{ width: 'auto' }} />
          Don't ask again in this browser session
        </label>
      </ConfirmDialog>

      <ProposeDialog open={propose} onClose={() => setPropose(false)} sql={sql} paramDefs={paramDefs} dataspace={wb.dataspace} />
    </div>
  );
}
