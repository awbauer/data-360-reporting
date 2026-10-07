import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { estimate, newPlan, type CreditPlan } from '@shared/credits';
import { insightForecast, objectForecast, type Counts } from '@shared/credit-forecast';
import { attributedCredits, summarize } from '@shared/consumption';
import { useCachedConsumption } from '../../lib/consumption';
import type { SeedCandidate } from '@shared/credits-seed';
import type { ObjectMeta } from '@shared/types';
import { api } from '../../api';
import { useWorkbench } from '../../context';
import { useRateCard } from '../../lib/creditPrefs';
import { fmtAgo, fmtCredits, fmtNum } from '../../lib/format';
import { useOrgSeed } from '../../lib/useOrgSeed';
import { useStreamsFor } from '../Lineage';
import { CardPicker, Credits, ForecastCard } from './Forecast';

/** Common actions on a DMO or DLO: query it, segment or transform over it, ingest it, share it. */
export function ObjectCredits({ obj, counts }: { obj: ObjectMeta; counts: Counts }) {
  const [card] = useRateCard();
  const streams = useStreamsFor(obj.name);
  const key = streams.map((s) => s.name).join('|');
  // `streams` is a fresh array each render; `key` says when its contents change.
  const f = useMemo(() => objectForecast(card, obj, counts, { streams }), [card, obj, counts, key]);
  const names = [obj.name, obj.label, ...streams.flatMap((s) => [s.name, s.label])];
  return (
    <ForecastCard title="Credits for common actions" forecast={f} context={obj.label} what="object">
      <ActualLine names={names} quietIfNone={obj.kind === 'dmo'} />
    </ForecastCard>
  );
}

/**
 * What this thing really consumed lately, from the hourly consumption feed, if it has been read
 * (Credits, Actual consumption). Matched on its API name or label.
 */
export function ActualLine({ names, quietIfNone, estimate }: {
  names: string[];
  quietIfNone?: boolean;
  /** The forecast for a month at its schedule, to flag when reality is far from it. */
  estimate?: { monthly: number; label: string };
}) {
  const data = useCachedConsumption();
  const [card] = useRateCard();
  if (!data?.sources.resources) return null;
  const { credits, matched } = attributedCredits(data.resources, names);
  if (!matched.length) {
    return quietIfNone ? null : (
      <div className="small muted actual-line">Nothing consumed under this name since {data.resourcesSince} (consumption read {fmtAgo(data.at)}).</div>
    );
  }
  // Actuals cover ~30 days, so they compare with a month of the forecast.
  const ratio = estimate && estimate.monthly > 0 ? credits / estimate.monthly : null;
  const far = ratio !== null && (ratio > 2 || ratio < 0.5);
  return (
    <div className="small actual-line">
      <b>Actually consumed since {data.resourcesSince}: <Credits value={credits} card={card} unit="credits" /></b>
      <span className="muted"> ({matched.map((m) => m.resourceType ?? m.resource).join(', ')}; read {fmtAgo(data.at)}, <Link to="/credits/actual">details</Link>)</span>
      {far && (
        <div className="actual-gap">
          That’s {ratio! >= 1 ? `${fmtRatio(ratio!)}× more than` : `${fmtRatio(1 / ratio!)}× less than`} the estimate {estimate!.label} ({fmtCredits(estimate!.monthly)} a month).
          The estimate’s inputs don’t match how it really runs: the objects it reads may be bigger than counted, or it may run more
          {ratio! >= 1 ? ' often' : ' rarely'} than its schedule says.
        </div>
      )}
    </div>
  );
}

/** An insight's run, its schedule and the alternatives, from the objects its SQL reads. */
export function InsightCredits({ obj, counts }: { obj: ObjectMeta; counts: Counts }) {
  const wb = useWorkbench();
  const [card] = useRateCard();
  const host = wb.session.instanceHost ?? '';
  const def = useQuery({ queryKey: ['insight', host, obj.name], queryFn: () => api.insight(obj.name), retry: false });
  const f = useMemo(() => insightForecast(card, obj, def.data, wb.objects, counts), [card, obj, def.data, wb.objects, counts]);
  return (
    <ForecastCard title="Credits for this insight" forecast={f} context={obj.label} what="insight">
      <ActualLine names={[obj.name, obj.label]} estimate={scheduleEstimate(f)} />
      {def.isLoading && <div className="small muted">Reading the definition…</div>}
      {def.error && <div className="small muted">The definition isn’t available ({def.error.message}), so the objects it reads are unknown.</div>}
    </ForecastCard>
  );
}

const fmtRatio = (r: number) => (r >= 10 ? Math.round(r).toLocaleString('en-US') : r.toFixed(1));

/** The forecast's month at the thing's own schedule, or daily when it has none, for comparing with actuals. */
export function scheduleEstimate(f: { actions: { id: string; monthly: number | null; label: string }[] }): { monthly: number; label: string } | undefined {
  const own = f.actions.find((a) => a.id === 'schedule');
  if (own?.monthly != null) return { monthly: own.monthly, label: own.label.replace(/^At its schedule/, 'at its schedule') };
  const daily = f.actions.find((a) => a.id === 'every-24');
  return daily?.monthly != null ? { monthly: daily.monthly, label: 'if run daily' } : undefined;
}

const GROUPS: SeedCandidate['group'][] = ['Data streams', 'Identity resolution', 'Calculated insights', 'Segments', 'Activations'];

/**
 * What the org already runs, for a month: its streams, identity resolution, insights, segments
 * and activations priced together (so Flex tiers apply to the org's combined usage). On demand,
 * because it reads every insight's definition (metadata only, no query credits).
 */
export function OrgCredits({ countsVersion }: { countsVersion: string }) {
  const wb = useWorkbench();
  const nav = useNavigate();
  const [card] = useRateCard();
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seed = useOrgSeed(on, 0.05, countsVersion);
  const consumption = useCachedConsumption();
  const actual = consumption?.daily.length ? summarize(consumption) : null;
  const result = useMemo(() => {
    if (!on || seed.loading) return null;
    const plan: CreditPlan = { ...newPlan('run-rate', card.id), months: 1, items: seed.candidates.map((c) => c.item) };
    const e = estimate(plan, card);
    const byId = new Map(e.items.map((x) => [x.id, x.total]));
    const groups = GROUPS.map((g) => {
      const list = seed.candidates.filter((c) => c.group === g);
      return { group: g, count: list.length, incomplete: list.filter((c) => c.incomplete).length, credits: list.reduce((t, c) => t + (byId.get(c.item.id) ?? 0), 0) };
    }).filter((g) => g.count > 0);
    return { total: e.total.pooled, groups, incomplete: seed.candidates.filter((c) => c.incomplete).length };
  }, [on, seed.loading, seed.candidates, card]);

  const openAsPlan = async () => {
    setError(null);
    try {
      const plan: CreditPlan = {
        ...newPlan(`${(wb.session.instanceHost ?? 'org').split('.')[0]} run-rate`),
        cardId: card.id,
        start: new Date().toISOString().slice(0, 7),
        items: seed.candidates.map((c) => ({ ...c.item, id: crypto.randomUUID() })),
      };
      const r = await api.plans.create(plan);
      nav(`/credits/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card">
      <div className="row wrap" style={{ marginBottom: 6 }}>
        <h2 className="grow" style={{ margin: 0 }}>Credits: what this org already runs</h2>
        <CardPicker />
      </div>
      <div className="small muted" style={{ marginBottom: 8 }}>
        A month of this data space’s streams, identity resolution, calculated insights, segments and activations, sized from their
        settings and the row counts counted below ({seed.counted} of {seed.objects} objects). It reads insight definitions, which
        is metadata: no queries, no credits. Each assumption is listed when you open it as a plan.
      </div>
      {!on ? (
        <button onClick={() => setOn(true)}>Estimate a month</button>
      ) : !result ? (
        <div className="muted small">Reading streams, segments{seed.insightCount ? ` and ${seed.insightCount} insight definitions` : ''}…</div>
      ) : (
        <>
          <div className="row wrap" style={{ alignItems: 'baseline', gap: 12 }}>
            <div className="tile-num"><Credits value={result.total} card={card} /></div>
            <div className="muted small">{card.credits} a month, estimated</div>
          </div>
          {actual && (
            <div className="small actual-line">
              <b>Actually consumed in the last 30 days: {fmtCredits(actual.last30)}</b>{' '}
              <span className="muted">
                ({actual.last30 > result.total ? 'more' : 'less'} than estimated, all cards; read {fmtAgo(consumption!.at)}, <Link to="/credits/actual">details</Link>)
              </span>
            </div>
          )}
          <table className="t" style={{ maxWidth: 640, marginTop: 8 }}>
            <thead><tr><th>From</th><th className="num">Activities</th><th className="num">Credits a month</th></tr></thead>
            <tbody>
              {result.groups.map((g) => (
                <tr key={g.group}>
                  <td>{g.group}{g.incomplete > 0 && <span className="muted small"> · {g.incomplete} without a row count (counted as 0)</span>}</td>
                  <td className="num">{fmtNum(g.count)}</td>
                  <td className="num">{fmtCredits(g.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {seed.extrasError && <div className="alert warn small" style={{ marginTop: 8 }}>Streams and segments couldn’t be read: {seed.extrasError}</div>}
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button onClick={() => void openAsPlan()} disabled={!seed.candidates.length}>Open as a plan</button>
            {result.incomplete > 0 && <span className="small muted">{result.incomplete} need a row count: count rows below, then estimate again.</span>}
            {error && <span className="small" role="alert" style={{ color: 'var(--bad)' }}>{error}</span>}
          </div>
        </>
      )}
    </section>
  );
}
