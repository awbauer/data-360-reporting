import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bars } from '../components/Bars';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useWorkbench } from '../context';
import { fmtAgo, fmtNum } from '../lib/format';
import { computeOverview } from '../lib/stats';
import { useRowCounts } from '../lib/useRowCounts';

export function Overview() {
  const wb = useWorkbench();
  const stats = useMemo(() => computeOverview(wb.objects), [wb.objects]);
  const rc = useRowCounts(wb.session.instanceHost ?? '', wb.dataspace, wb.objects);
  const [confirm, setConfirm] = useState(false);

  if (wb.metaLoading) return <div className="hint">Reading metadata…</div>;
  if (wb.metaError) {
    return (
      <div className="page">
        <div className="alert error" role="alert">Could not read metadata: {wb.metaError.message}</div>
        <div><button onClick={wb.reloadMetadata}>Retry</button></div>
      </div>
    );
  }

  const countable = wb.objects;
  const counted = Object.entries(rc.counts);
  const largest = counted.sort((a, b) => b[1].rows - a[1].rows).slice(0, 10);
  const oldest = counted.length ? counted.map(([, c]) => c.at).sort()[0]! : null;
  const totalRows = counted.reduce((n, [, c]) => n + c.rows, 0);

  return (
    <div className="page">
      <div className="row">
        <div className="grow">
          <h1>Overview</h1>
          <div className="muted small">
            Data space <b>{wb.dataspace}</b> · read from metadata only (no query credits used)
          </div>
        </div>
        <button onClick={wb.reloadMetadata}>Refresh metadata</button>
      </div>

      {wb.warnings.map((w) => (
        <div className="alert warn" key={w}>Partial metadata: {w}</div>
      ))}

      <div className="grid tiles">
        <Tile n={stats.counts.dmo} label="Data model objects" sub={stats.dmoByCategory.map(([c, n]) => `${n} ${c}`).join(' · ') || undefined} />
        <Tile n={stats.counts.dlo} label="Data lake objects" />
        <Tile n={stats.counts.ci} label="Calculated insights" />
        <Tile n={stats.totalFields} label="Fields" />
        <Tile n={stats.relationships} label="Relationships" />
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h2>Field types</h2>
          <Bars items={stats.typeMix.map(([label, value]) => ({ label, value }))} />
        </section>
        <section className="card">
          <h2>Most connected objects</h2>
          {stats.mostConnected.length ? (
            <div className="bars">
              {stats.mostConnected.map((o) => (
                <div className="bar-row" key={o.name}>
                  <Link className="name" to={`/explorer/${encodeURIComponent(o.name)}`}>{o.label}</Link>
                  <div className="bar-track"><div className="bar-fill alt" style={{ width: `${(o.neighbors / stats.mostConnected[0]!.neighbors) * 100}%` }} /></div>
                  <div className="val">{o.neighbors}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted small">No relationships found.</div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 className="grow" style={{ margin: 0 }}>Row counts</h2>
          {rc.progress ? (
            <>
              <span className="small muted">Counting {rc.progress.done}/{rc.progress.total}…</span>
              <button onClick={rc.cancel}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirm(true)} disabled={!countable.length}>
              {counted.length ? 'Recount all' : `Count rows for ${countable.length} objects`}
            </button>
          )}
        </div>
        {rc.error && <div className="alert warn" style={{ marginBottom: 12 }}>{rc.error}</div>}
        {counted.length ? (
          <>
            <div className="small muted" style={{ marginBottom: 8 }}>
              {fmtNum(totalRows)} rows across {counted.length} counted objects · oldest count {oldest ? fmtAgo(oldest) : ''}
            </div>
            <Bars items={largest.map(([name, c]) => ({ label: wb.byName.get(name)?.label ?? name, value: c.rows, title: `${name}: ${fmtNum(c.rows)} rows (${fmtAgo(c.at)})` }))} />
          </>
        ) : (
          <div className="muted small">
            Row counts run one query per object, so they are never started automatically. Counts are cached in this browser.
          </div>
        )}
      </section>

      <section className="card">
        <h2>Objects without relationships ({stats.isolated.length})</h2>
        {stats.isolated.length ? (
          <>
            <div className="muted small" style={{ marginBottom: 8 }}>Data model objects with no mapped relationships. These may be unmapped or orphaned.</div>
            <div className="chips">
              {stats.isolated.map((o) => (
                <Link className="chip" key={o.name} to={`/explorer/${encodeURIComponent(o.name)}`}>{o.label}</Link>
              ))}
            </div>
          </>
        ) : (
          <div className="muted small">Every data model object has at least one relationship.</div>
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        title="Count rows for every object?"
        confirmLabel={`Run ${countable.length} queries`}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void rc.scan(countable);
        }}
      >
        <p style={{ margin: 0 }}>
          This runs <b>{countable.length} queries</b> (<code>SELECT COUNT(*)</code>, three at a time) against data space{' '}
          <b>{wb.dataspace}</b>. Data 360 bills queries as consumption credits, so large objects can cost real money.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function Tile({ n, label, sub }: { n: number; label: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="num">{fmtNum(n)}</div>
      <div className="lbl">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
