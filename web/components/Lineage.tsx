import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ObjectMapping, ObjectMeta, StreamInfo } from '@shared/types';
import { api } from '../api';
import { useWorkbench } from '../context';
import { fmtAgo } from '../lib/format';
import { resolveObject } from '../lib/names';
import { useDloTargets } from '../lib/useDloTargets';

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

/** Streams that load a DLO. Shares the Overview's cached list. */
export function useStreamsFor(dloName: string): StreamInfo[] {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const extras = useQuery({ queryKey: ['extras', host, wb.dataspace], queryFn: () => api.extras(wb.dataspace) });
  const target = resolveObject(dloName, wb.byName, wb.objects)?.name ?? dloName;
  return (extras.data?.dataStreams?.items ?? []).filter(
    (s) => s.dataLakeObject && (resolveObject(s.dataLakeObject, wb.byName, wb.objects)?.name ?? s.dataLakeObject) === target,
  );
}

const streamNote = (s: StreamInfo) =>
  s.lastRefreshDate ? ` (refreshed ${fmtAgo(s.lastRefreshDate)}${s.lastRunStatus ? `, ${s.lastRunStatus.toLowerCase()}` : ''})` : '';

/**
 * Where a DMO's data comes from, or which DMOs a DLO feeds. Read from the mapping endpoint:
 * metadata only, no query credits.
 */
export function Lineage({ obj }: { obj: ObjectMeta }) {
  return obj.kind === 'dlo' ? <DloFeeds obj={obj} /> : <DmoSources obj={obj} />;
}

function DmoSources({ obj }: { obj: ObjectMeta }) {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const res = useQuery({
    // Shared with the DLO walk, so opening DMOs and walking from a DLO fill the same cache.
    queryKey: ['mappings', host, wb.dataspace, obj.name],
    queryFn: () => api.mappings(wb.dataspace, obj.name),
    staleTime: 15 * 60_000,
  });
  const title = 'Where this data comes from';
  if (res.isLoading) return <div className="card"><h2>{title}</h2><div className="muted small">Reading mappings…</div></div>;
  if (res.error) {
    return <div className="card"><h2>{title}</h2><div className="alert warn small">Could not read mappings: {res.error.message}</div></div>;
  }
  const mappings = res.data?.mappings ?? [];
  const label = (name: string) => obj.fields.find((f) => f.name === name)?.label;
  const mapped = new Set(mappings.flatMap((m) => m.fields.map((f) => f.target)));
  const unmapped = obj.fields.filter((f) => !mapped.has(f.name));
  return (
    <div className="card">
      <h2>{title}</h2>
      {mappings.length ? (
        <>
          {mappings.map((m) => (
            <MappingTable
              key={m.name}
              m={m}
              heading={<>From <ObjLink name={m.source} /><StreamsSuffix dlo={m.source} /></>}
              left="This field"
              right="Source field"
              leftOf={(f) => f.target}
              rightOf={(f) => f.source}
              label={label}
              arrow="←"
            />
          ))}
          {unmapped.length > 0 && (
            <div className="small" style={{ marginTop: 8 }}>
              <b>{unmapped.length} field{unmapped.length === 1 ? '' : 's'} with no source mapping:</b>{' '}
              <span className="muted">{unmapped.map((f) => f.label).join(', ')}</span>
            </div>
          )}
        </>
      ) : (
        <div className="muted small">
          No data lake object is mapped to this object{obj.kind === 'ci' ? '' : '. It may be populated by identity resolution, a calculated insight or a data transform'}.
        </div>
      )}
      <Raw value={res.data?.raw} />
    </div>
  );
}

function StreamsSuffix({ dlo }: { dlo: string }) {
  const streams = useStreamsFor(dlo);
  return streams.length ? <span className="muted small"> · loaded by {streams.map((s) => s.label).join(', ')}</span> : null;
}

function DloFeeds({ obj }: { obj: ObjectMeta }) {
  const t = useDloTargets(obj);
  const streams = useStreamsFor(obj.name);
  const title = 'What this feeds';
  const label = (name: string) => obj.fields.find((f) => f.name === name)?.label;
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="small" style={{ marginBottom: 8 }}>
        {streams.length ? (
          <>Loaded by {streams.map((s, i) => <span key={s.name}>{i ? ', ' : ''}data stream <b>{s.label}</b><span className="muted">{streamNote(s)}</span></span>)}.</>
        ) : (
          <span className="muted">No data stream reports loading this object.</span>
        )}
      </div>

      {t.progress ? (
        <div className="row small">
          <span className="grow muted">Looking up mappings… {t.progress.done} of {t.progress.total} data model objects</span>
          <button type="button" onClick={t.cancel}>Cancel</button>
        </div>
      ) : t.complete ? (
        <>
          {t.failed > 0 && <div className="alert warn small" style={{ marginBottom: 8 }}>{t.failed} lookup{t.failed === 1 ? '' : 's'} failed, so this may be incomplete.</div>}
          {t.targets.length ? (
            t.targets.map((m) => (
              <MappingTable
                key={m.name}
                m={m}
                heading={<>Feeds <ObjLink name={m.target} /></>}
                left="This field"
                right="Target field"
                leftOf={(f) => f.source}
                rightOf={(f) => f.target}
                label={label}
                arrow="→"
              />
            ))
          ) : (
            <div className="muted small">Not mapped to any of the {t.totalDmos} data model objects in this data space.</div>
          )}
          <Raw value={t.raw} />
        </>
      ) : (
        <div className="row small" style={{ gap: 12 }}>
          <button type="button" onClick={() => void t.scan()} disabled={!t.totalDmos}>Find the objects this feeds</button>
          <span className="grow muted">
            Salesforce can only list mappings into one data model object at a time, so this looks at each of the {t.totalDmos} in
            this data space: {t.totalDmos} API calls, no query credits. Kept for 15 minutes and reused by other pages.
          </span>
        </div>
      )}
      {!t.progress && !t.complete && t.targets.length > 0 && (
        <div className="small" style={{ marginTop: 8 }}>
          <b>Found so far (not every object has been checked):</b>
          {t.targets.map((m) => <div key={m.name}><ObjLink name={m.target} /></div>)}
        </div>
      )}
      {t.failed > 0 && !t.complete && <div className="alert warn small" style={{ marginTop: 8 }}>{t.failed} lookup{t.failed === 1 ? '' : 's'} failed.</div>}
    </div>
  );
}

function MappingTable({ m, heading, left, right, leftOf, rightOf, label, arrow }: {
  m: ObjectMapping;
  heading: React.ReactNode;
  left: string;
  right: string;
  leftOf: (f: ObjectMapping['fields'][number]) => string;
  rightOf: (f: ObjectMapping['fields'][number]) => string;
  label: (name: string) => string | undefined;
  arrow: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ margin: '4px 0' }}>
        {heading}
        {m.status && m.status !== 'ACTIVE' && <span className="badge" style={{ marginLeft: 8 }}>{m.status.toLowerCase()}</span>}
      </h3>
      <table className="t">
        <thead><tr><th>{left}</th><th aria-hidden /><th>{right}</th></tr></thead>
        <tbody>
          {m.fields.map((f, i) => (
            <tr key={i}>
              <td>{label(leftOf(f)) ?? leftOf(f)}<div><code className="muted">{leftOf(f)}</code></div></td>
              <td className="muted" aria-hidden>{arrow}</td>
              <td><code>{rightOf(f)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');

/** A calculated insight's definition: its SQL expression and how each dimension and measure is computed. */
export function InsightDefinitionCard({ obj }: { obj: ObjectMeta }) {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const res = useQuery({
    queryKey: ['insight', host, obj.name],
    queryFn: () => api.insight(obj.name),
    staleTime: 15 * 60_000,
  });
  if (res.isLoading) return <div className="card"><h2>Definition</h2><div className="muted small">Reading definition…</div></div>;
  if (res.error || !res.data) {
    return <div className="card"><h2>Definition</h2><div className="alert warn small">Could not read the definition: {res.error?.message}</div></div>;
  }
  const d = res.data;
  const when = (iso?: string) => (iso ? `${new Date(iso).toLocaleString()} (${fmtAgo(iso)})` : undefined);
  const facts = [
    ['Status', d.status ? `${words(d.status)}${d.enabled === false ? ' · disabled' : ''}` : d.enabled === false ? 'disabled' : undefined],
    ['Definition', d.definitionStatus ? words(d.definitionStatus) : undefined],
    ['Type', d.definitionType ? words(d.definitionType) : undefined],
    ['Last run', d.lastRunStatus ? `${words(d.lastRunStatus)}${d.lastRunAt ? `, ${when(d.lastRunAt)}` : ''}` : when(d.lastRunAt)],
    ['Last run error', d.lastRunError],
    ['Schedule', d.schedule ? words(d.schedule) : undefined],
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
      {fields.length > 0 && (
        <table className="t" style={{ marginTop: 8 }}>
          <thead><tr><th>Field</th><th>Role</th><th>Type</th><th>Computed as</th></tr></thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.name}>
                <td>{f.label}<div><code className="muted">{f.name}</code></div></td>
                <td>{f.role}</td>
                <td>{f.dataType ?? ''}</td>
                <td className="mono small">{f.formula ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Raw value={d.raw} />
    </div>
  );
}
