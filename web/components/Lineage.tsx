import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ObjectMapping, ObjectMeta } from '@shared/types';
import { api } from '../api';
import { useWorkbench } from '../context';
import { fmtAgo } from '../lib/format';
import { resolveObject } from '../lib/names';

/** Raw upstream JSON, for checking shapes the app only knows from the spec. */
function Raw({ value }: { value: unknown }) {
  return (
    <details className="small" style={{ marginTop: 8 }}>
      <summary className="muted">Raw API response</summary>
      <pre className="sql" style={{ maxHeight: 280 }}>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function ObjLink({ name }: { name: string }) {
  const wb = useWorkbench();
  const o = resolveObject(name, wb.byName, wb.objects);
  return o ? <Link to={`/explorer/${encodeURIComponent(o.name)}`}>{o.label}</Link> : <code>{name}</code>;
}

/**
 * Where a DMO's data comes from (which DLO fields map to each field), or what a DLO feeds.
 * Read from the mapping endpoint: metadata only, no query credits.
 */
export function Lineage({ obj }: { obj: ObjectMeta }) {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const kind = obj.kind === 'dlo' ? 'dlo' : 'dmo';
  const res = useQuery({
    queryKey: ['mappings', host, wb.dataspace, obj.name],
    queryFn: () => api.mappings(wb.dataspace, obj.name, kind),
    staleTime: 15 * 60_000,
  });
  // Shares the Overview's cache; used to say which stream loads a DLO.
  const extras = useQuery({ queryKey: ['extras', host, wb.dataspace], queryFn: () => api.extras(wb.dataspace) });
  const streamsFor = (dlo: string) => {
    const target = resolveObject(dlo, wb.byName, wb.objects)?.name ?? dlo;
    return (extras.data?.dataStreams?.items ?? []).filter((s) => s.dataLakeObject && (resolveObject(s.dataLakeObject, wb.byName, wb.objects)?.name ?? s.dataLakeObject) === target);
  };
  const title = kind === 'dmo' ? 'Where this data comes from' : 'What this feeds';

  if (res.isLoading) return <div className="card"><h2>{title}</h2><div className="muted small">Reading mappings…</div></div>;
  if (res.error) {
    return (
      <div className="card">
        <h2>{title}</h2>
        <div className="alert warn small">Could not read mappings: {res.error.message}</div>
      </div>
    );
  }
  const mappings = res.data?.mappings ?? [];
  const field = (name: string) => obj.fields.find((f) => f.name === name)?.label;

  if (kind === 'dlo') {
    const streams = streamsFor(obj.name);
    return (
      <div className="card">
        <h2>{title}</h2>
        <div className="small" style={{ marginBottom: 8 }}>
          {streams.length
            ? <>Loaded by {streams.map((s, i) => <span key={s.name}>{i ? ', ' : ''}data stream <b>{s.label}</b>{s.lastRefreshDate ? <span className="muted"> (refreshed {fmtAgo(s.lastRefreshDate)}{s.lastRunStatus ? `, ${s.lastRunStatus.toLowerCase()}` : ''})</span> : null}</span>)}.</>
            : <span className="muted">No data stream reports loading this object.</span>}
        </div>
        {mappings.length ? mappings.map((m) => (
          <MappingTable key={m.name} m={m} heading={<>Feeds <ObjLink name={m.target} /></>} left="This field" right="Target field" leftOf={(f) => f.source} rightOf={(f) => f.target} label={field} />
        )) : <div className="muted small">Not mapped to any data model object.</div>}
        <Raw value={res.data?.raw} />
      </div>
    );
  }

  const mapped = new Set(mappings.flatMap((m) => m.fields.map((f) => f.target)));
  const unmapped = obj.fields.filter((f) => !mapped.has(f.name));
  return (
    <div className="card">
      <h2>{title}</h2>
      {mappings.length ? (
        <>
          {mappings.map((m) => {
            const streams = streamsFor(m.source);
            return (
              <MappingTable
                key={m.name}
                m={m}
                heading={<>From <ObjLink name={m.source} />{streams.length ? <span className="muted small"> · loaded by {streams.map((s) => s.label).join(', ')}</span> : null}</>}
                left="This field"
                right="Source field"
                leftOf={(f) => f.target}
                rightOf={(f) => f.source}
                label={field}
              />
            );
          })}
          {unmapped.length > 0 && (
            <div className="small" style={{ marginTop: 8 }}>
              <b>{unmapped.length} field{unmapped.length === 1 ? '' : 's'} with no source mapping:</b>{' '}
              <span className="muted">{unmapped.map((f) => f.label).join(', ')}</span>
            </div>
          )}
        </>
      ) : (
        <div className="muted small">No data lake object is mapped to this object{obj.kind === 'ci' ? '' : '. It may be populated by identity resolution, a calculated insight or a data transform'}.</div>
      )}
      <Raw value={res.data?.raw} />
    </div>
  );
}

function MappingTable({ m, heading, left, right, leftOf, rightOf, label }: {
  m: ObjectMapping;
  heading: React.ReactNode;
  left: string;
  right: string;
  leftOf: (f: ObjectMapping['fields'][number]) => string;
  rightOf: (f: ObjectMapping['fields'][number]) => string;
  label: (name: string) => string | undefined;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ margin: '4px 0' }}>{heading}</h3>
      <table className="t">
        <thead><tr><th>{left}</th><th aria-hidden /><th>{right}</th></tr></thead>
        <tbody>
          {m.fields.map((f, i) => (
            <tr key={i}>
              <td>{label(leftOf(f)) ?? leftOf(f)}<div><code className="muted">{leftOf(f)}</code></div></td>
              <td className="muted" aria-hidden>{left === 'This field' && right === 'Source field' ? '←' : '→'}</td>
              <td><code>{rightOf(f)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A calculated insight's definition: its SQL expression and how each dimension and measure is computed. */
export function InsightDefinitionCard({ obj }: { obj: ObjectMeta }) {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const res = useQuery({
    queryKey: ['insight', host, wb.dataspace, obj.name],
    queryFn: () => api.insight(wb.dataspace, obj.name),
    staleTime: 15 * 60_000,
  });
  if (res.isLoading) return <div className="card"><h2>Definition</h2><div className="muted small">Reading definition…</div></div>;
  if (res.error || !res.data) {
    return <div className="card"><h2>Definition</h2><div className="alert warn small">Could not read the definition: {res.error?.message}</div></div>;
  }
  const d = res.data;
  const facts = [
    ['Status', d.status], ['Last run', d.lastRunStatus], ['Last run at', d.lastRunAt ? `${new Date(d.lastRunAt).toLocaleString()} (${fmtAgo(d.lastRunAt)})` : undefined],
    ['Type', d.definitionType], ['Schedule', d.schedule],
  ].filter((x): x is [string, string] => Boolean(x[1]));
  const fields = [...d.dimensions.map((f) => ({ ...f, role: 'dimension' })), ...d.measures.map((f) => ({ ...f, role: 'measure' }))];
  return (
    <div className="card">
      <h2>Definition</h2>
      {d.description && <p className="small" style={{ marginTop: 0 }}>{d.description}</p>}
      {facts.length > 0 && (
        <dl className="facts small">
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {d.expression ? <pre className="sql" style={{ maxHeight: 320 }}>{d.expression}</pre> : <div className="muted small">The API returned no expression for this insight.</div>}
      {fields.some((f) => f.formula) && (
        <table className="t" style={{ marginTop: 8 }}>
          <thead><tr><th>Field</th><th>Role</th><th>Computed as</th></tr></thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.name}><td>{f.label}<div><code className="muted">{f.name}</code></div></td><td>{f.role}</td><td className="mono small">{f.formula ?? ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <Raw value={d.raw} />
    </div>
  );
}
