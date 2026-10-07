import { beforeAll, describe, expect, it } from 'vitest';
import { DAILY, RATE_CARD } from '../shared/credits';
import {
  actionToItem,
  insightForecast,
  isSourceProfile,
  objectForecast,
  priceAction,
  queryForecast,
  segmentForecast,
  segmentMonthly,
  type Counts,
  type Forecast,
} from '../shared/credit-forecast';
import { createMockClient } from '../server/data360/mock/client';
import type { Extras, InsightDefinition, ObjectMeta } from '../shared/types';

const client = createMockClient();
let objects: ObjectMeta[];
let extras: Extras;
let insight: InsightDefinition;
const at = '2026-10-06T00:00:00Z';
const counts: Counts = {
  ssot__Individual__dlm: { rows: 2_000_000, at },
  UnifiedIndividual__dlm: { rows: 1_500_000, at },
  ssot__EmailEngagement__dlm: { rows: 40_000_000, at },
  Contact_Home__dll: { rows: 1_000_000, at },
};
const obj = (name: string) => objects.find((o) => o.name === name)!;
const act = (f: Forecast, id: string) => f.actions.find((a) => a.id === id)!;

beforeAll(async () => {
  objects = (await client.getMetadata('default')).objects;
  extras = await client.getExtras('default');
  insight = await client.getCalculatedInsight('Avg_Spends__cio');
});

describe('pricing one action', () => {
  it('uses the same engine as plans, tiers included', () => {
    // A first full unification of 10M profiles crosses into tier 2 and bills entirely there.
    const a = priceAction(RATE_CARD, { id: 'x', label: 'x', kind: 'unification', units: 10e6, runsPerMonth: 0 });
    expect(a).toMatchObject({ once: 600_000, monthly: null, usageType: 'unification', free: false });
    const q = priceAction(RATE_CARD, { id: 'q', label: 'q', kind: 'queries', units: 5e6, runsPerMonth: DAILY });
    expect(q.once).toBe(15);
    expect(q.monthly).toBeCloseTo(15 * DAILY, 6);
  });
});

describe('objects', () => {
  it('prices a counted data model object, with identity resolution for source profiles', () => {
    const f = objectForecast(RATE_CARD, obj('ssot__Individual__dlm'), counts);
    expect(f.rows).toBe(2_000_000);
    expect(act(f, 'query').once).toBeCloseTo(6, 9); // 2M rows × 3 per million
    expect(act(f, 'segment-daily').monthly).toBeCloseTo(2 * 50 * DAILY, 6);
    expect(act(f, 'segment-rapid').monthly).toBeCloseTo(2 * 50 * DAILY * 6, 6);
    expect(act(f, 'ir-full').once).toBe(150_000);
    expect(act(f, 'ir-daily').units).toBe(100_000);
    expect(f.actions.map((a) => a.id)).not.toContain('stream');
  });

  it('prices per million rows when the object has no cached count', () => {
    const f = objectForecast(RATE_CARD, obj('ssot__Account__dlm'), counts);
    expect(f.rows).toBeNull();
    expect(act(f, 'query').once).toBe(3);
    expect(act(f, 'query').detail).toMatch(/per million rows/);
  });

  it('only offers identity resolution on source profile objects', () => {
    expect(isSourceProfile(obj('ssot__Individual__dlm'))).toBe(true);
    expect(isSourceProfile(obj('UnifiedIndividual__dlm'))).toBe(false);
    expect(isSourceProfile(obj('IndividualIdentityLink__dlm'))).toBe(false);
    expect(isSourceProfile(obj('ssot__EmailEngagement__dlm'))).toBe(false);
  });

  it('prices a data lake object’s own stream, and the alternatives it doesn’t use', () => {
    const crm = extras.dataStreams!.items.filter((s) => s.dataLakeObject === 'Contact_Home__dll');
    const f = objectForecast(RATE_CARD, obj('Contact_Home__dll'), counts, { streams: crm });
    const stream = act(f, 'stream');
    expect(stream).toMatchObject({ kind: 'ingest_internal', free: true, once: 0 });
    expect(stream.detail).toMatch(/native Salesforce connector/);
    expect(act(f, 'ingest-batch').free).toBe(true); // no Flex usage type for batch ingestion
    expect(act(f, 'ingest-stream').monthly).toBeCloseTo(3_500, 6); // 1M rows a month
  });
});

describe('insights', () => {
  it('prices a run from the objects its SQL reads, and other schedules when it has none', () => {
    const f = insightForecast(RATE_CARD, obj('Avg_Spends__cio'), insight, objects, counts);
    expect(f.reads).toEqual([{ name: 'ssot__Individual__dlm', rows: 2_000_000 }]);
    expect(act(f, 'run').once).toBe(80); // 2M rows × 40 (Prep)
    // The fixture is NOT_SCHEDULED: no "at its schedule", but each alternative is priced.
    expect(f.actions.map((a) => a.id)).toEqual(['run', 'every-1', 'every-6', 'every-12', 'every-24', 'query']);
    expect(act(f, 'every-24').monthly).toBeCloseTo(80 * DAILY, 6);
  });

  it('shows its own schedule and skips the matching alternative', () => {
    const f = insightForecast(RATE_CARD, obj('Avg_Spends__cio'), { ...insight, schedule: 'SIX' }, objects, counts);
    expect(act(f, 'schedule').label).toBe('At its schedule (every 6 hours)');
    expect(f.actions.map((a) => a.id)).not.toContain('every-6');
  });
});

describe('segments', () => {
  it('reads every object a segment uses, at its publish interval, plus activation', () => {
    const vip = extras.segments!.items.find((s) => s.apiName === 'Lapsed_VIPs')!;
    const f = segmentForecast(RATE_CARD, vip, objects, counts);
    expect(f.rows).toBe(1_500_000 + 2_000_000 + 40_000_000);
    expect(f.scheduleKnown).toBe(true);
    expect(act(f, 'schedule').label).toBe('At its schedule (every 24 hours)');
    expect(f.actions.map((a) => a.id)).not.toContain('every-24');
    expect(act(f, 'activation').units).toBe(312);
    expect(segmentMonthly(RATE_CARD, vip, objects, counts)).toEqual({ rows: f.rows, runs: DAILY, scheduleKnown: true, monthly: act(f, 'schedule').monthly });
    const unknown = extras.segments!.items.find((s) => s.apiName === 'New_Subscribers')!;
    expect(segmentMonthly(RATE_CARD, unknown, objects, counts)).toMatchObject({ rows: null, monthly: null, scheduleKnown: false });
    // Rapid publish over 43.5M rows a refresh crosses tiers: cheaper per row than daily.
    expect(act(f, 'every-1').monthly! / 24).toBeLessThan(act(f, 'schedule').monthly!);
  });
});

describe('queries and plans', () => {
  it('needs every object counted to give a total', () => {
    expect(queryForecast(RATE_CARD, ['ssot__Individual__dlm', 'Contact_Home__dll'], counts).rows).toBe(3_000_000);
    const partial = queryForecast(RATE_CARD, ['ssot__Individual__dlm', 'ssot__Account__dlm'], counts);
    expect(partial.rows).toBeNull();
    expect(partial.reads).toEqual([{ name: 'ssot__Individual__dlm', rows: 2_000_000 }, { name: 'ssot__Account__dlm', rows: null }]);
  });

  it('turns actions into plan activities: one-offs as one-time volume, the rest as runs', () => {
    expect(actionToItem({ id: 'a', label: 'Full run', kind: 'unification', units: 5e6, runsPerMonth: 0 }, 'i1', 'Individual'))
      .toMatchObject({ kind: 'unification', initial: 5e6, perRun: 0, label: 'Individual: Full run', source: 'Individual' });
    expect(actionToItem({ id: 'b', label: 'Daily', kind: 'segmentation', units: 1e6, runsPerMonth: DAILY }, 'i2', 'VIPs'))
      .toMatchObject({ perRun: 1e6, runsPerMonth: DAILY, initial: 0 });
  });
});
