import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { estimate, newItem, newPlan } from '@shared/credits';
import { segmentForecast, segmentMonthly, type Counts } from '@shared/credit-forecast';
import type { SegmentInfo } from '@shared/types';
import { api } from '../api';
import { CardPicker, Credits, ForecastCard } from '../components/credits/Forecast';
import { useWorkbench } from '../context';
import { useRateCard } from '../lib/creditPrefs';
import { fmtAgo, fmtCompact, fmtNum } from '../lib/format';
import { describePublishInterval } from '@shared/schedule';
import { prettyCriteria, resolveObject } from '../lib/names';
import { cachedCounts } from '../lib/storage';

const inactive = (s: SegmentInfo) => /inactive|disabled/i.test(s.status ?? '');

/** Segments in the current data space with their rules, read-only. List data only: no query credits. */
export function SegmentsPage() {
  const wb = useWorkbench();
  const host = wb.session.instanceHost ?? '';
  const extras = useQuery({ queryKey: ['extras', host, wb.dataspace], queryFn: () => api.extras(wb.dataspace) });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [card] = useRateCard();
  const listing = extras.data?.segments ?? null;
  const counts = useMemo(() => cachedCounts(host, wb.dataspace, wb.objects), [host, wb.dataspace, wb.objects]);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (listing?.items ?? [])
      .filter((s) => !needle || `${s.apiName} ${s.label} ${s.description ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [listing, q]);
  const monthly = useMemo(
    () => new Map((listing?.items ?? []).map((s) => [s.apiName, segmentMonthly(card, s, wb.objects, counts)])),
    [listing, card, wb.objects, counts],
  );
  // Active segments priced together, so Flex tiers apply to their combined refreshes.
  const total = useMemo(() => {
    const priced = (listing?.items ?? []).filter((s) => !inactive(s) && monthly.get(s.apiName)?.rows != null);
    const plan = {
      ...newPlan('segments', card.id),
      months: 1,
      items: priced.map((s) => newItem('segmentation', s.apiName, { perRun: monthly.get(s.apiName)!.rows!, runsPerMonth: monthly.get(s.apiName)!.runs })),
    };
    const active = (listing?.items ?? []).filter((s) => !inactive(s)).length;
    return { credits: estimate(plan, card).total.pooled, priced: priced.length, active };
  }, [listing, monthly, card]);

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
      {listing && listing.items.length > 0 && (
        <div className="card credit-note">
          <div className="row wrap">
            <div className="grow small">
              {total.priced > 0 ? (
                <>
                  <b>About <Credits value={total.credits} card={card} /> {card.credits} a month</b> to refresh the {total.priced} active
                  segment{total.priced === 1 ? '' : 's'} that can be priced{total.priced < total.active ? ` (of ${total.active})` : ''}, at their publish schedules.{' '}
                </>
              ) : (
                <><b>Segment credits can’t be priced yet.</b>{' '}</>
              )}
              <span className="muted">
                Every refresh reads all rows of the objects a segment uses, whatever its member count, so the size of those objects and how
                often it publishes are what cost. Sizes come from row counts cached on the <Link to="/overview">Overview</Link>
                {' '}({Object.keys(counts).length} of {wb.objects.length} objects counted). Activation is extra: see a segment’s details.
              </span>
            </div>
            <CardPicker />
          </div>
        </div>
      )}
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
                <th style={{ textAlign: 'right' }}>Members (last)</th><th>Last published</th>
                <th style={{ textAlign: 'right' }} title="Rows read by each refresh">Rows a refresh</th>
                <th style={{ textAlign: 'right' }} title={`${card.name}, at the segment's publish schedule`}>Credits a month</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <SegmentRow
                  key={s.apiName}
                  s={s}
                  m={monthly.get(s.apiName)!}
                  counts={counts}
                  open={open === s.apiName}
                  onToggle={() => setOpen(open === s.apiName ? null : s.apiName)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SegmentRow({ s, m, counts, open, onToggle }: {
  s: SegmentInfo;
  m: ReturnType<typeof segmentMonthly>;
  counts: Counts;
  open: boolean;
  onToggle: () => void;
}) {
  const wb = useWorkbench();
  const [card] = useRateCard();
  const on = s.segmentOn ? resolveObject(s.segmentOn, wb.byName, wb.objects) : undefined;
  const forecast = useMemo(() => (open ? segmentForecast(card, s, wb.objects, counts) : null), [open, card, s, wb.objects, counts]);
  return (
    <>
      <tr>
        <td>{s.label}<div><code className="muted">{s.apiName}</code></div>{s.description && <div className="small muted">{s.description}</div>}</td>
        <td>{on ? <Link to={`/explorer/${encodeURIComponent(on.name)}`}>{on.label}</Link> : s.segmentOn ? <code>{s.segmentOn}</code> : ''}</td>
        <td>{s.status ?? ''}</td>
        <td>{s.publishStatus ?? <span className="muted">never</span>}</td>
        <td style={{ textAlign: 'right' }}>{s.lastMemberCount !== undefined ? fmtNum(s.lastMemberCount) : ''}</td>
        <td>{s.lastPublished ? <span title={new Date(s.lastPublished).toLocaleString()}>{fmtAgo(s.lastPublished)}</span> : ''}</td>
        <td style={{ textAlign: 'right' }}>
          {m.rows !== null ? fmtCompact(m.rows) : <span className="muted" title="An object it reads has no cached row count">?</span>}
        </td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {m.monthly !== null ? (
            <span title={m.scheduleKnown ? `At its schedule (${s.publishInterval})` : 'Its schedule is unknown: assumed daily'}>
              {Math.round(m.monthly).toLocaleString('en-US')}{!m.scheduleKnown && <span className="muted">*</span>}
            </span>
          ) : <span className="muted">–</span>}
        </td>
        <td className="right">
          <button className="link" onClick={onToggle} aria-expanded={open} aria-label={`Details for ${s.label}`}>
            {open ? 'hide' : 'details'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ background: 'var(--surface-2)' }}>
            {(s.publishInterval || s.nextPublish) && (
              <div className="small muted" style={{ marginBottom: 8 }}>
                {s.publishInterval ? `Publishes ${describePublishInterval(s.publishInterval)}` : 'Publish schedule unknown'}
                {s.nextPublish ? ` · next ${new Date(s.nextPublish).toLocaleString()}` : ''}
              </div>
            )}
            {s.includeCriteria || s.excludeCriteria ? (
              <div className="grid cols-2">
                <Criteria title="Include" text={s.includeCriteria} />
                <Criteria title="Exclude" text={s.excludeCriteria} />
              </div>
            ) : (
              <div className="small muted">The API returned no rules for this segment.</div>
            )}
            {forecast && (
              <div style={{ marginTop: 12 }}>
                <ForecastCard title="Credits for this segment" forecast={forecast} context={s.label} what="segment" />
              </div>
            )}
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
