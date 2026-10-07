import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITIES,
  DAILY,
  DATA_SERVICES_2025_08,
  FLEX_2026_06,
  FREQUENCIES,
  RATE_CARDS,
  chargeRun,
  estimate,
  levers,
  monthLabel,
  newItem,
  newPlan,
  parseQuantity,
  type CreditPlan,
  type PlanItem,
} from '../shared/credits';
import { planMarkdown, planTables, roundCredits } from '../shared/credits-report';

let seq = 0;
const item = (kind: PlanItem['kind'], over: Partial<PlanItem> = {}) => newItem(kind, `i${++seq}`, over);
const plan = (items: PlanItem[], over: Partial<CreditPlan> = {}): CreditPlan => ({ ...newPlan('Test'), items, ...over });

describe('rate cards', () => {
  it('map every activity to a usage type of the same unit, or say why not', () => {
    for (const card of Object.values(RATE_CARDS)) {
      for (const a of ACTIVITIES) {
        const m = card.map[a.kind];
        expect(m, `${card.id} ${a.kind}`).toBeDefined();
        if (m.usageType) expect(card.usageTypes[m.usageType]?.unit, `${card.id} ${a.kind}`).toBe(a.unit);
        else expect(m.note, `${card.id} ${a.kind} needs a note`).toBeTruthy();
      }
    }
  });

  it('give Flex four falling tiers per usage type, sandbox at the tier-2 rate', () => {
    expect(FLEX_2026_06.tiers).toEqual([300_000, 1_500_000, 12_500_000]);
    for (const u of Object.values(FLEX_2026_06.usageTypes)) {
      expect(u.production, u.id).toHaveLength(4);
      expect([...u.production].sort((a, b) => b - a)).toEqual(u.production);
      expect(u.sandbox).toBe(u.production[1]);
    }
  });

  it('agree with the query rate the Overview quotes', () => {
    const src = readFileSync(new URL('../web/pages/Overview.tsx', import.meta.url), 'utf8');
    expect(Number(/const QUERY_RATE = ([\d.]+);/.exec(src)?.[1])).toBe(FLEX_2026_06.usageTypes.queries!.production[0]);
  });

  it('keep Data Services flat, with the published multipliers', () => {
    expect(DATA_SERVICES_2025_08.tiers).toBeUndefined();
    const m = (id: string) => DATA_SERVICES_2025_08.usageTypes[id]!.production;
    expect(m('pipeline_batch')).toEqual([2_000]);
    expect(m('unification')).toEqual([100_000]);
    expect(m('segmentation')).toEqual([20]);
    expect(m('queries')).toEqual([2]);
    expect(m('internal')).toEqual([0]);
  });
});

describe('charging a run', () => {
  // Trailhead "Maximize Your Data 360 Credits": batch calculated insight on 20 million rows.
  it('matches the published Data Services example', () => {
    expect(chargeRun(20, 0, [15], undefined).credits).toBe(300);
  });

  it('matches the published Flex example, including the run that crosses into tier 2', () => {
    const prep = FLEX_2026_06.usageTypes.prep!.production;
    expect(chargeRun(20, 0, prep, FLEX_2026_06.tiers).credits).toBe(800);
    // 299,600 used; 800 more would end past 300,000, so the whole run bills at tier 2 (32).
    expect(chargeRun(20, 299_600, prep, FLEX_2026_06.tiers)).toEqual({ credits: 640, tier: 1 });
  });

  it('treats tier thresholds as inclusive', () => {
    const prep = FLEX_2026_06.usageTypes.prep!.production;
    // Ends exactly on the 300,000th credit: still base.
    expect(chargeRun(1, 299_960, prep, FLEX_2026_06.tiers)).toEqual({ credits: 40, tier: 0 });
    // Starts at credit 300,001: tier 2.
    expect(chargeRun(1, 300_000, prep, FLEX_2026_06.tiers)).toEqual({ credits: 32, tier: 1 });
  });
});

describe('estimate', () => {
  it('bills a large first unification run at the tier it ends in, then resets next month', () => {
    const p = plan([item('unification', { initial: 10_000_000, perRun: 0 }), item('unification', { initial: 1_000_000, perRun: 0, startMonth: 2 })], { months: 2 });
    const e = estimate(p);
    // 10M × 75,000/M would end at 750,000 credits, past 300,000: the whole run bills at 60,000/M.
    expect(e.items[0]!.monthly).toEqual([600_000, 0]);
    // A new month starts at base again.
    expect(e.items[1]!.monthly).toEqual([0, 75_000]);
    expect(e.usage[0]!.tier).toEqual([1, 0]);
  });

  it('prices the same activities under Data Services, where batch ingestion bills and Flex has no usage type', () => {
    const items = [item('ingest_batch', { perRun: 1_000_000, runsPerMonth: 30 }), item('ingest_internal', { perRun: 50_000_000, runsPerMonth: 30 })];
    const flex = estimate(plan(items, { months: 1 }));
    const ds = estimate(plan(items, { months: 1, cardId: 'data-services-2025-08' }));
    expect(flex.total.pooled).toBe(0);
    expect(flex.items.every((i) => i.free && !i.unpriced)).toBe(true);
    expect(flex.warnings).toEqual([]);
    expect(ds.total.pooled).toBeCloseTo(30 * 2_000, 6);
    expect(ds.items[1]!.total).toBe(0);
  });

  it('flags activities a card doesn’t price, and counts them as 0', () => {
    const e = estimate(plan([item('inferences', { perRun: 1_000_000 })]));
    expect(e.items[0]!.unpriced).toBe(true);
    expect(e.total.pooled).toBe(0);
    expect(e.warnings[0]).toMatch(/Model inferences: Not on the Flex/);
  });

  it('spreads runs over the month in time order across activities that share a usage type', () => {
    // Two daily segment refreshes of 100M rows each: 30.4 × 2 × 100 × 50 = 304,166 credits at base,
    // which would cross 300,000. The crossing run and everything after bills at tier 2.
    const e = estimate(plan([item('segmentation', { perRun: 100e6, runsPerMonth: DAILY }), item('segmentation', { perRun: 100e6, runsPerMonth: DAILY })], { months: 1 }));
    const total = e.total.pooled;
    expect(total).toBeLessThan(2 * DAILY * 100 * 50);
    expect(total).toBeGreaterThan(2 * DAILY * 100 * 40);
    // Both items share the cost about equally: their runs interleave.
    expect(Math.abs(e.items[0]!.total - e.items[1]!.total)).toBeLessThan(5_000);
  });

  it('keeps totals exact on a flat card however finely runs are grouped', () => {
    const every15 = FREQUENCIES.find((f) => f.id === '15m')!.runs;
    const e = estimate(plan([item('queries', { perRun: 2_000_000, runsPerMonth: every15 })], { cardId: 'data-services-2025-08', months: 3 }));
    expect(e.total.pooled).toBeCloseTo(3 * every15 * 2 * 2, 6);
  });

  it('applies annual growth to recurring volume only, and honours start and end months', () => {
    const p = plan([item('ci_batch', { perRun: 10e6, runsPerMonth: 1, initial: 5e6, startMonth: 2, endMonth: 13 })], {
      cardId: 'data-services-2025-08', months: 14, growthPct: 12,
    });
    const m = estimate(p).items[0]!.monthly;
    expect(m[0]).toBe(0);
    expect(m[1]).toBeCloseTo((5 + 10 * 1.12 ** (1 / 12)) * 15, 6);
    expect(m[12]).toBeCloseTo(10 * 1.12 ** 1 * 15, 6);
    expect(m[13]).toBe(0);
  });

  it('keeps Data Services sandbox credits off the entitlement, and pools them under Flex', () => {
    const items = [item('segmentation', { perRun: 1e6, runsPerMonth: 1, env: 'sandbox' })];
    const ds = estimate(plan(items, { cardId: 'data-services-2025-08', months: 1 }));
    expect(ds.total).toEqual({ production: 0, sandbox: 16, pooled: 0 });
    expect(ds.warnings.join(' ')).toMatch(/separate Data Services credits for Sandbox/);
    const flex = estimate(plan(items, { months: 1 }));
    expect(flex.total).toEqual({ production: 0, sandbox: 40, pooled: 40 });
  });

  it('uses an override as a flat multiplier for that usage type', () => {
    const p = plan([item('unification', { initial: 10e6, perRun: 0 })], { months: 1, overrides: { unification: 50_000 } });
    expect(estimate(p).total.pooled).toBe(500_000);
  });

  it('runs the entitlement down with actuals where entered, and says when it runs out', () => {
    const p = plan([item('segmentation', { perRun: 100e6, runsPerMonth: 10 })], { months: 4, entitlement: 150_000, actuals: [{ month: 1, credits: 80_000 }] });
    const e = estimate(p);
    expect(e.months.map((m) => m.pooled)).toEqual([50_000, 50_000, 50_000, 50_000]);
    expect(e.months.map((m) => m.cumulative)).toEqual([80_000, 130_000, 180_000, 230_000]);
    expect(e.months[0]!.actual).toBe(80_000);
    expect(e.exhaustedMonth).toBe(3);
    expect(e.months[3]!.remaining).toBe(-80_000);
  });

  it('prices the term with the plan’s price per 100k credits', () => {
    const p = plan([item('segmentation', { perRun: 100e6, runsPerMonth: 10 })], { months: 2, pricePer100k: 500 });
    expect(estimate(p).cost).toBe(500);
    expect(estimate({ ...p, pricePer100k: undefined }).cost).toBeNull();
  });
});

describe('levers', () => {
  it('prices streaming-to-batch and refresh-frequency changes by re-estimating', () => {
    const stream = item('ingest_streaming', { label: 'Web events', perRun: 2e6 });
    const seg = item('segmentation', { label: 'VIPs', perRun: 50e6, runsPerMonth: DAILY * 24 });
    const daily = item('segmentation', { label: 'Daily one', perRun: 50e6, runsPerMonth: DAILY });
    const p = plan([stream, seg, daily]);
    const lv = levers(p);
    const base = estimate(p).total.pooled;
    expect(lv.map((l) => l.itemId).sort()).toEqual([seg.id, stream.id].sort());
    for (const l of lv) {
      const next = { ...p, items: p.items.map((it) => (it.id === l.itemId ? { ...it, ...l.patch } : it)) };
      expect(l.saves).toBeCloseTo(base - estimate(next).total.pooled, 6);
    }
    // Batch ingestion has no Flex usage type, so the whole streaming cost goes.
    expect(lv.find((l) => l.itemId === stream.id)!.saves).toBeCloseTo(estimate(plan([stream])).total.pooled, 6);
    expect(lv[0]!.saves).toBeGreaterThanOrEqual(lv[1]!.saves);
  });
});

describe('lever limit', () => {
  it('tries only the costliest candidates, since each try is a full estimate', () => {
    const small = item('ingest_streaming', { perRun: 1e5 });
    const big = item('ingest_streaming', { perRun: 5e6 });
    const mid = item('ingest_streaming', { perRun: 1e6 });
    expect(levers(plan([small, big, mid]), undefined, undefined, 2).map((l) => l.itemId)).toEqual([big.id, mid.id]);
  });
});

describe('helpers', () => {
  it('parses shorthand quantities', () => {
    expect(parseQuantity('5m')).toBe(5_000_000);
    expect(parseQuantity('2.5K')).toBe(2_500);
    expect(parseQuantity('1,200,000')).toBe(1_200_000);
    expect(parseQuantity(' 3 b ')).toBe(3e9);
    expect(parseQuantity('.5m')).toBe(500_000);
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('-4')).toBeNull();
    expect(parseQuantity('5x')).toBeNull();
  });

  it('labels months from the contract start, across years', () => {
    expect(monthLabel({ start: '2026-11' }, 1)).toBe('Nov 2026');
    expect(monthLabel({ start: '2026-11' }, 3)).toBe('Jan 2027');
    expect(monthLabel({}, 3)).toBe('Month 3');
  });
});

describe('export', () => {
  const p = plan(
    [
      item('unification', { label: 'Individuals', initial: 8e6, perRun: 200_000, assumption: '5% change a day' }),
      item('ingest_streaming', { label: 'Web | SDK', perRun: 1e6 }),
      item('inferences', { perRun: 1e6 }),
    ],
    { start: '2026-11', entitlement: 5_000_000, pricePer100k: 500, client: 'Acme' },
  );
  const at = new Date('2026-10-07T12:00:00Z');
  const tables = planTables(p, at);

  it('records the card, its source, the assumptions and the other card’s total', () => {
    const [about, items] = tables;
    const v = (k: string) => about!.rows.find((r) => r[0] === k)?.[1];
    expect(v('Rate card')).toBe('Flex Credits (June 2026), as of 2026-06-17');
    expect(String(v('Rate card source'))).toMatch(/Flex-Credits-Rate-Card-06\.17\.2026\.pdf$/);
    expect(v('Same plan under Data Services credits (August 2025)')).toBe(roundCredits(estimate({ ...p, cardId: 'data-services-2025-08' }).total.pooled));
    expect(about!.rows.some((r) => r[0] === 'Warning' && /inferences/i.test(String(r[1])))).toBe(true);
    expect(items!.rows[0]).toContain('5% change a day');
    expect(items!.rows[2]![3]).toMatch(/^Not priced/);
  });

  it('writes Markdown with escaped cells and one section per table', () => {
    const md = planMarkdown(tables);
    expect(md).toMatch(/^# Credit estimate: Test/);
    expect(md).toContain('Web \\| SDK');
    expect(md).toContain('## By month');
    expect(md).toContain('## Rate card: Flex Credits (June 2026)');
    expect(md).toContain('Nov 2026');
  });
});
