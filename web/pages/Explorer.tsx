import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { buildJoinSql, cardinalityText } from '@shared/join';
import { buildPreviewSql, buildProfileBatches, buildRowCountSql, parseProfileRows, quoteIdent, type ObjectProfile } from '@shared/sql';
import type { CellValue, ObjectKind, ObjectMeta } from '@shared/types';
import { runToCompletion } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FieldDistribution } from '../components/FieldDistribution';
import { InsightDefinitionCard, Lineage } from '../components/Lineage';
import { RelationshipMap } from '../components/RelationshipMap';
import { useWorkbench } from '../context';
import { fmtAgo, fmtNum, fmtPct } from '../lib/format';
import { cachedCounts, countCache, getCountsVersion, profileCache, subscribeCounts } from '../lib/storage';
import { InsightCredits, ObjectCredits } from '../components/credits/ObjectCredits';
import { creditsFor, fmtEstCredits, fmtRows } from '@shared/estimate';
import { profileRows } from '@shared/estimate';
import { exampleCost } from '../lib/estimateText';
import { isLinearType } from '@shared/histogram';

const KIND_LABEL: Record<ObjectKind, string> = { dmo: 'DMO', dlo: 'DLO', ci: 'CI' };
const MAX_LIST = 500;

export function Explorer() {
  const wb = useWorkbench();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | ObjectKind>('all');
  const [category, setCategory] = useState('all');

  const categories = useMemo(() => [...new Set(wb.objects.map((o) => o.category))].sort(), [wb.objects]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return wb.objects
      .filter((o) => (kind === 'all' || o.kind === kind) && (category === 'all' || o.category === category))
      .filter((o) => !needle || o.name.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [wb.objects, q, kind, category]);

  if (wb.metaLoading) return <div className="hint">Reading metadata…</div>;
  if (wb.metaError) return <div className="hint">Could not read metadata: {wb.metaError.message}</div>;

  return (
    <div className="split">
      <aside>
        <div className="filters">
          <input type="search" placeholder={`Search ${wb.objects.length} objects…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search objects" />
          <div className="row">
            <select className="grow" value={kind} onChange={(e) => setKind(e.target.value as 'all' | ObjectKind)} aria-label="Kind">
              <option value="all">All kinds</option>
              <option value="dmo">Data model objects</option>
              <option value="dlo">Data lake objects</option>
              <option value="ci">Calculated insights</option>
            </select>
            <select className="grow" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="list">
          {filtered.slice(0, MAX_LIST).map((o) => (
            <NavLink key={o.name} to={`/explorer/${encodeURIComponent(o.name)}`} className={({ isActive }) => `obj-item${isActive ? ' active' : ''}`}>
              <div className="name">{o.label}</div>
              <div className="meta">
                <span className={`badge ${o.kind}`}>{KIND_LABEL[o.kind]}</span>
                <span>{o.category}</span>
                <span>· {o.fields.length} fields</span>
              </div>
            </NavLink>
          ))}
          {filtered.length > MAX_LIST && <div className="hint small">Showing {MAX_LIST} of {fmtNum(filtered.length)}. Refine the search.</div>}
          {!filtered.length && <div className="hint small">No objects match.</div>}
        </div>
      </aside>
      <section>
        <Routes>
          <Route path=":name" element={<ObjectDetail />} />
          <Route index element={<div className="hint">Select an object to see its fields, relationships and data profile.</div>} />
        </Routes>
      </section>
    </div>
  );
}

function ObjectDetail() {
  const wb = useWorkbench();
  const nav = useNavigate();
  const { name = '' } = useParams();
  const obj = wb.byName.get(decodeURIComponent(name));
  const host = wb.session.instanceHost ?? '';

  if (!obj) return <div className="hint">Object “{name}” was not found in data space {wb.dataspace}.</div>;
  return <ObjectBody key={`${wb.dataspace}/${obj.name}`} obj={obj} host={host} nav={nav} />;
}

function ObjectBody({ obj, host, nav }: { obj: ObjectMeta; host: string; nav: ReturnType<typeof useNavigate> }) {
  const wb = useWorkbench();
  const ds = wb.dataspace;
  const [profile, setProfile] = useState<ObjectProfile | null>(() => profileCache.get(host, ds, obj.name));
  const [count, setCount] = useState(() => countCache.get(host, ds, obj.name));
  // Every cached count (an insight's cost depends on the objects it reads), with this one live.
  const countsVersion = useSyncExternalStore(subscribeCounts, getCountsVersion);
  const counts = useMemo(
    () => ({ ...cachedCounts(host, ds, wb.objects), ...(count ? { [obj.name]: count } : {}) }),
    // `countsVersion` changes when any count is cached, anywhere in the app.
    [host, ds, wb.objects, obj.name, count, countsVersion],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const batches = useMemo(() => buildProfileBatches(obj), [obj]);
  const openInEditor = (sql: string, autorun: boolean) => nav('/query', { state: { sql, dataspace: ds, autorun } });

  const countRows = async () => {
    setBusy('Counting rows…');
    setError(null);
    try {
      const r = await runToCompletion(
        { sql: buildRowCountSql(obj), dataspace: ds, ...(count ? { estRows: count.rows, estComplete: true } : {}) },
        { maxRows: 1 },
      );
      const entry = { rows: Number(r.rows[0]?.[0] ?? 0), at: new Date().toISOString() };
      countCache.set(host, ds, obj.name, entry);
      setCount(entry);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runProfile = async () => {
    setConfirm(false);
    setError(null);
    try {
      const rows: CellValue[][] = [];
      for (let i = 0; i < batches.length; i++) {
        setBusy(`Profiling… ${i + 1}/${batches.length}`);
        const r = await runToCompletion({ sql: batches[i]!.sql, dataspace: ds, ...(count ? { estRows: count.rows, estComplete: true } : {}) }, { maxRows: 1 });
        if (!r.rows[0]) throw new Error('Profile query returned no rows');
        rows.push(r.rows[0]);
      }
      const p = parseProfileRows(batches, rows);
      profileCache.set(host, ds, obj.name, p);
      countCache.set(host, ds, obj.name, { rows: p.rows, at: p.computedAt });
      setProfile(p);
      setCount({ rows: p.rows, at: p.computedAt });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const neighbors = useMemo(() => {
    const seen = new Set<string>();
    return obj.relationships.flatMap((r) => {
      const other = r.fromEntity === obj.name ? r.toEntity : r.fromEntity;
      const dir = r.fromEntity === obj.name ? '→' : '←';
      const key = `${dir}${other}${r.fromEntityAttribute}${r.toEntityAttribute}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...r, other, dir }];
    });
  }, [obj]);

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="row wrap">
        <div className="grow">
          <div className="row">
            <h1>{obj.label}</h1>
            <span className={`badge ${obj.kind}`}>{KIND_LABEL[obj.kind]}</span>
            <span className="badge">{obj.category}</span>
          </div>
          <code className="muted">{obj.name}</code>
        </div>
        <button onClick={() => openInEditor(buildPreviewSql(obj, 100), true)}>Preview 100 rows</button>
        <button onClick={() => openInEditor(`SELECT ${obj.fields.map((f) => quoteIdent(f.name)).join(', ')}\nFROM ${quoteIdent(obj.name)}\nLIMIT 100`, false)}>Open in editor</button>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="card">
        <div className="row wrap">
          <div className="grow">
            <b>{count ? `${fmtNum(count.rows)} rows` : 'Row count not loaded'}</b>
            {count && <span className="muted small"> · counted {fmtAgo(count.at)}</span>}
            {profile && <span className="muted small"> · profiled {fmtAgo(profile.computedAt)}</span>}
          </div>
          {busy ? <span className="muted">{busy}</span> : (
            <>
              <button onClick={() => void countRows()}>{count ? 'Recount' : 'Count rows'} (1 query)</button>
              <button onClick={() => setConfirm(true)}>{profile ? 'Re-profile' : 'Profile fields'}</button>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="t">
          <thead>
            <tr>
              <th>Field</th><th>Type</th><th>Keys</th>
              <th className="num">Non-null</th><th className="num">Distinct≈</th><th>Min – Max</th><th />
            </tr>
          </thead>
          <tbody>
            {obj.fields.map((f) => {
              const p = profile?.fields[f.name];
              const isOpen = open.has(f.name);
              return (
                <FieldRows key={f.name} colSpan={7} expanded={isOpen} detail={isOpen && (
                  <FieldDistribution obj={obj} field={f} dataspace={ds} profile={p} totalRows={profile?.rows} />
                )}>
                  <td>
                    <div>{f.label}{f.role && <span className="badge" style={{ marginLeft: 6 }}>{f.role}</span>}</div>
                    <code className="muted">{f.name}</code>
                  </td>
                  <td><code>{f.type}</code></td>
                  <td>{f.isPk && <span className="badge dmo">PK</span>} {f.keyQualifier && <span className="badge" title={`Key qualifier ${f.keyQualifier}`}>KQ</span>}</td>
                  <td className="num">
                    {p ? (
                      <span title={`${fmtNum(p.nonNull)} non-null`}>
                        {fmtPct(1 - p.nullRate)} <span className="nullbar"><i style={{ width: `${(1 - p.nullRate) * 100}%`, background: 'var(--good)' }} /></span>
                      </span>
                    ) : <span className="muted">–</span>}
                  </td>
                  <td className="num">{p ? fmtNum(p.distinct) : <span className="muted">–</span>}</td>
                  <td className="mono small">{p && p.min !== undefined ? `${String(p.min ?? '')} – ${String(p.max ?? '')}` : <span className="muted">–</span>}</td>
                  <td className="right">
                    <button
                      className="link"
                      aria-expanded={isOpen}
                      onClick={() => setOpen((cur) => {
                        const next = new Set(cur);
                        if (!next.delete(f.name)) next.add(f.name);
                        return next;
                      })}
                    >
                      {isOpen ? 'hide' : isLinearType(f.type) ? 'histogram' : 'top values'}
                    </button>
                  </td>
                </FieldRows>
              );
            })}
          </tbody>
        </table>
      </div>

      {obj.kind === 'ci' ? <InsightCredits obj={obj} counts={counts} /> : <ObjectCredits obj={obj} counts={counts} />}

      {obj.kind === 'ci' ? <InsightDefinitionCard obj={obj} /> : <Lineage obj={obj} />}

      <div className="card">
        <h2>Relationships ({neighbors.length})</h2>
        {neighbors.length ? (
          <div className="stack">
            <RelationshipMap center={obj} byName={wb.byName} onOpen={(n) => nav(`/explorer/${encodeURIComponent(n)}`)} />
            <table className="t">
              <thead><tr><th /><th>Object</th><th>Join</th><th>Cardinality</th><th /></tr></thead>
              <tbody>
                {neighbors.map((r, i) => {
                  const from = wb.byName.get(r.fromEntity);
                  const to = wb.byName.get(r.toEntity);
                  const sql = from && to ? buildJoinSql(from, to, r) : null;
                  return (
                    <tr key={i}>
                      <td title={r.dir === '→' ? 'This object references the other' : 'The other object references this one'}>{r.dir}</td>
                      <td><Link to={`/explorer/${encodeURIComponent(r.other)}`}>{wb.byName.get(r.other)?.label ?? r.other}</Link></td>
                      <td className="mono small">{r.fromEntityAttribute ?? '?'} = {r.toEntityAttribute ?? '?'}</td>
                      <td>{cardinalityText(r.cardinality)}</td>
                      <td className="right">
                        <button
                          className="link"
                          disabled={!sql}
                          title={sql ? 'Open a JOIN of these two objects in the editor (not run)' : 'Both objects must be visible in this data space'}
                          onClick={() => sql && openInEditor(sql, false)}
                        >
                          Build JOIN
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <span className="muted small">No relationships.</span>}
      </div>

      <ConfirmDialog
        open={confirm}
        title={`Profile ${obj.label}?`}
        confirmLabel={`Run ${batches.length} ${batches.length === 1 ? 'query' : 'queries'}`}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void runProfile()}
      >
        <p style={{ margin: 0 }}>
          Computes row count, non-null count, approximate distinct count and min/max for <b>{obj.fields.length}</b> fields using{' '}
          <b>{batches.length}</b> full-scan {batches.length === 1 ? 'query' : 'queries'}. Results are cached in this browser.
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          {count
            ? `${fmtRows(count.rows)} rows × ${batches.length} ${batches.length === 1 ? 'query' : 'queries'}: roughly ${fmtEstCredits(creditsFor(profileRows(count.rows, batches.length)))} credits.`
            : `${exampleCost()}, once per query. This object hasn't been counted, so its size is unknown.`}{' '}
          An estimate: Salesforce reports no credit usage.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** A table row plus an optional full-width detail row beneath it. */
function FieldRows({ children, detail, expanded, colSpan }: { children: React.ReactNode; detail?: React.ReactNode; expanded: boolean; colSpan: number }) {
  return (
    <>
      <tr>{children}</tr>
      {expanded && <tr><td colSpan={colSpan} style={{ background: 'var(--surface-2)' }}>{detail}</td></tr>}
    </>
  );
}
