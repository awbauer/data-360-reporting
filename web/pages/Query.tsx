import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { findParams } from '@shared/sql';
import type { ParamDef, ParamType } from '@shared/types';
import { api, type RunInput } from '../api';
import { ParamForm } from '../components/ParamForm';
import { ProposeDialog } from '../components/ProposeDialog';
import { ResultsGrid } from '../components/ResultsGrid';
import { SqlEditor } from '../components/SqlEditor';
import { useWorkbench } from '../context';
import { fmtMs, fmtNum } from '../lib/format';
import { draft, history } from '../lib/storage';
import { MAX_IN_MEMORY, useQueryRunner } from '../lib/useQueryRunner';

export interface QueryNavState {
  sql: string;
  dataspace?: string;
  autorun?: boolean;
  paramDefs?: ParamDef[];
  params?: Record<string, string>;
}

export function QueryPage() {
  const wb = useWorkbench();
  const nav = useNavigate();
  const location = useLocation();
  const incoming = location.state as QueryNavState | null;

  const initial = useMemo(() => incoming ?? draft.get() ?? undefined, []);
  const [sql, setSql] = useState(initial?.sql ?? '');
  const [resetKey, setResetKey] = useState(0);
  const [defs, setDefs] = useState<Record<string, ParamDef>>(() => Object.fromEntries((initial?.paramDefs ?? []).map((d) => [d.name, d])));
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = { ...(initial?.params ?? {}) };
    for (const d of initial?.paramDefs ?? []) if (v[d.name] === undefined && d.default !== undefined) v[d.name] = d.default;
    return v;
  });
  const [propose, setPropose] = useState(false);
  const names = useMemo(() => findParams(sql), [sql]);

  const onFinished = useCallback(
    (input: RunInput, s: { rows: number; elapsedMs: number }) =>
      history.add({
        id: crypto.randomUUID(), at: new Date().toISOString(), sql: input.sql, dataspace: input.dataspace,
        paramDefs: input.paramDefs ?? [], params: input.params ?? {}, rows: s.rows, elapsedMs: s.elapsedMs,
      }),
    [],
  );
  const runner = useQueryRunner(onFinished);
  const { state } = runner;

  // Switch to the library query's data space, if it names one the user can access.
  useEffect(() => {
    if (incoming?.dataspace && incoming.dataspace !== wb.dataspace && wb.dataspaces.some((d) => d.name === incoming.dataspace)) {
      wb.setDataspace(incoming.dataspace);
    }
  }, []);

  // Seed a starter query once, when the page opens empty and metadata arrives. Never again:
  // the user clearing the editor must not bring it back.
  const seeded = useRef(Boolean(initial?.sql));
  useEffect(() => {
    if (!seeded.current && wb.objects.length) {
      seeded.current = true;
      const first = wb.objects.find((o) => o.kind === 'dmo') ?? wb.objects[0]!;
      setSql(`SELECT *\nFROM "${first.name}"\nLIMIT 100`);
      setResetKey((k) => k + 1);
    }
  }, [wb.objects]);

  const paramDefs = useMemo<ParamDef[]>(() => names.map((n) => defs[n] ?? { name: n, type: 'string' }), [names, defs]);

  useEffect(() => {
    const t = setTimeout(() => draft.set({ sql, paramDefs, params: values }), 400);
    return () => clearTimeout(t);
  }, [sql, paramDefs, values]);

  const run = useCallback(() => {
    if (!sql.trim() || state.phase === 'running') return;
    void runner.start({ sql, dataspace: wb.dataspace, paramDefs, params: values });
  }, [sql, wb.dataspace, paramDefs, values, runner, state.phase]);

  const runRef = useRef(run);
  runRef.current = run;

  const autoran = useRef(false);
  useEffect(() => {
    if (incoming?.autorun && !autoran.current && sql) {
      autoran.current = true;
      nav('.', { replace: true, state: { ...incoming, autorun: false } });
      runRef.current();
    }
  }, [incoming, sql, nav]);

  const running = state.phase === 'running';
  const canMore = state.phase === 'done' && state.rows.length < state.rowCount && state.rows.length < MAX_IN_MEMORY;

  return (
    <div
      className="qwrap"
      onKeyDown={(e) => {
        // The editor handles its own Mod+Enter (and marks it handled); this covers the param inputs.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) {
          e.preventDefault();
          runRef.current();
        }
      }}
    >
      <div className="toolbar">
        <button className="primary" onClick={run} disabled={running || !sql.trim()} title="Ctrl/⌘ + Enter">▶ Run</button>
        <button onClick={runner.cancel} disabled={!running}>Cancel</button>
        <span className="muted small">Data space: <b>{wb.dataspace}</b></span>
        <div className="grow" />
        {state.queryId && state.phase === 'done' ? (
          <a href={api.exportUrl(state.queryId, state.dataspace, state.columns)} download>
            <button>Export CSV</button>
          </a>
        ) : <button disabled>Export CSV</button>}
        <button onClick={() => setPropose(true)} disabled={!sql.trim()}>Propose to library…</button>
      </div>

      <SqlEditor value={sql} resetKey={resetKey} onChange={setSql} onRun={() => runRef.current()} objects={wb.objects} />

      <div>
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
        </div>
      </div>

      <div className="results">
        {state.phase === 'error' && <div className="alert error" style={{ margin: 12, whiteSpace: 'pre-wrap' }} role="alert">{state.error}</div>}
        {state.columns.length > 0 && <ResultsGrid columns={state.columns} rows={state.rows} />}
        {state.phase === 'done' && state.columns.length === 0 && <div className="hint">The query returned no columns.</div>}
      </div>

      <ProposeDialog open={propose} onClose={() => setPropose(false)} sql={sql} paramDefs={paramDefs} dataspace={wb.dataspace} />
    </div>
  );
}
