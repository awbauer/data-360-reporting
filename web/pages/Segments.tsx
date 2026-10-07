import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SegmentInfo } from '@shared/types';
import { api } from '../api';
import { useWorkbench } from '../context';
import { fmtAgo, fmtNum } from '../lib/format';
import { prettyCriteria, resolveObject } from '../lib/names';

/** Segments in the current data space with their rules, read-only. List data only: no query credits. */
export function SegmentsPage() {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const extras = useQuery({ queryKey: ['extras', host, wb.dataspace], queryFn: () => api.extras(wb.dataspace) });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const listing = extras.data?.segments ?? null;
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (listing?.items ?? [])
      .filter((s) => !needle || `${s.apiName} ${s.label} ${s.description ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [listing, q]);

  return (
    <div className="page">
      <div className="row wrap">
        <div className="grow">
          <h1>Segments</h1>
          <div className="muted small">
            Data space <b>{wb.dataspace}</b> · rules as the API returns them, read-only
            {listing ? ` · ${fmtNum(listing.total)}${listing.truncated ? '+' : ''} segments` : ''}
          </div>
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter segments" aria-label="Filter segments" />
      </div>
      {extras.isLoading && <div className="hint">Loading…</div>}
      {extras.error && <div className="alert error">{extras.error.message}</div>}
      {extras.data && !listing && (
        <div className="alert warn">Segments are unavailable: {extras.data.errors.find((e) => /segment/i.test(e)) ?? 'the request failed'}</div>
      )}
      {listing?.truncated && <div className="alert warn small">Only the first {fmtNum(listing.items.length)} segments were read.</div>}
      {listing && !items.length && <div className="alert">{q ? 'No segments match.' : 'No segments in this data space.'}</div>}
      {items.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="t">
            <thead>
              <tr>
                <th>Segment</th><th>Built on</th><th>Status</th><th>Publish status</th>
                <th style={{ textAlign: 'right' }}>Members (last)</th><th>Last published</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <SegmentRow key={s.apiName} s={s} open={open === s.apiName} onToggle={() => setOpen(open === s.apiName ? null : s.apiName)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SegmentRow({ s, open, onToggle }: { s: SegmentInfo; open: boolean; onToggle: () => void }) {
  const wb = useWorkbench();
  const on = s.segmentOn ? resolveObject(s.segmentOn, wb.byName, wb.objects) : undefined;
  const hasRules = Boolean(s.includeCriteria || s.excludeCriteria);
  return (
    <>
      <tr>
        <td>{s.label}<div><code className="muted">{s.apiName}</code></div>{s.description && <div className="small muted">{s.description}</div>}</td>
        <td>{on ? <Link to={`/explorer/${encodeURIComponent(on.name)}`}>{on.label}</Link> : s.segmentOn ? <code>{s.segmentOn}</code> : ''}</td>
        <td>{s.status ?? ''}</td>
        <td>{s.publishStatus ?? <span className="muted">never</span>}</td>
        <td style={{ textAlign: 'right' }}>{s.lastMemberCount !== undefined ? fmtNum(s.lastMemberCount) : ''}</td>
        <td>{s.lastPublished ? <span title={new Date(s.lastPublished).toLocaleString()}>{fmtAgo(s.lastPublished)}</span> : ''}</td>
        <td className="right">
          <button className="link" onClick={onToggle} aria-expanded={open} disabled={!hasRules} title={hasRules ? undefined : 'The API returned no criteria for this segment'}>
            {open ? 'hide rules' : 'rules'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--surface-2)' }}>
            <div className="grid cols-2">
              <Criteria title="Include" text={s.includeCriteria} />
              <Criteria title="Exclude" text={s.excludeCriteria} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Criteria({ title, text }: { title: string; text?: string }) {
  return (
    <div>
      <h3 style={{ margin: '0 0 4px' }}>{title}</h3>
      {text ? <pre className="sql" style={{ maxHeight: 360 }}>{prettyCriteria(text)}</pre> : <div className="muted small">None.</div>}
    </div>
  );
}
