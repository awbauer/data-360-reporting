import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { estimate, newPlan, type CreditPlan } from '@shared/credits';
import { insightForecast, objectForecast, type Counts } from '@shared/credit-forecast';
import type { SeedCandidate } from '@shared/credits-seed';
import type { ObjectMeta } from '@shared/types';
import { api } from '../../api';
import { useWorkbench } from '../../context';
import { useRateCard } from '../../lib/creditPrefs';
import { fmtCredits, fmtNum } from '../../lib/format';
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
  return <ForecastCard title="Credits for common actions" forecast={f} context={obj.label} what="object" />;
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
      {def.isLoading && <div className="small muted">Reading the definition…</div>}
      {def.error && <div className="small muted">The definition isn’t available ({def.error.message}), so the objects it reads are unknown.</div>}
    </ForecastCard>
  );
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
            <div className="muted small">{card.credits} a month</div>
          </div>
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
