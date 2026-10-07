import { describe, expect, it } from 'vitest';
import { changedRates, creditsFor, effectiveRates, fmtCredits, fmtMoney, fmtRows, RATE_CARD, USAGE_IDS } from '../shared/credits';
import { estimateScan, profileRows } from '../shared/estimate';
import {
  applyPrefill,
  emptyPlan,
  lineCredits,
  newLine,
  planTables,
  prefillLines,
  runsPerMonthFromFrequency,
  runsPerMonthFromPublishInterval,
  sanitizePlan,
  summarizePlan,
} from '../shared/plan';
import type { IdentityRuleset, ObjectMeta, SegmentInfo, StreamInfo } from '../shared/types';

const obj = (name: string, label = name): ObjectMeta => ({ name, label, kind: 'dmo', category: 'Profile', fields: [], primaryKeys: [], relationships: [] });

describe('rate card', () => {
  it('is marked unverified and covers every usage type once', () => {
    expect(RATE_CARD.verified).toBe(false);
    expect(RATE_CARD.source).toMatch(/Check every rate against your contract/);
    expect(new Set(USAGE_IDS).size).toBe(USAGE_IDS.length);
    expect(USAGE_IDS).toContain('unification');
  });

  it('applies valid overrides and ignores nonsense ones', () => {
    expect(effectiveRates().query).toBe(3);
    const r = effectiveRates({ rates: { query: 2, unification: -5, segmentation: Number.NaN, activation: 0 } });
    expect(r.query).toBe(2);
    expect(r.unification).toBe(75000); // negative: ignored
    expect(r.segmentation).toBe(50); // NaN: ignored
    expect(r.activation).toBe(0); // zero is a legitimate negotiated rate
    expect(changedRates({ rates: { query: 2, activation: 0, ['ingest-batch']: 2000 } })).toEqual(['query', 'activation']);
  });

  it('turns rows into credits and formats them', () => {
    expect(creditsFor(100_000_000, 3)).toBe(300);
    expect(creditsFor(0, 3)).toBe(0);
    expect([0, 0.004, 0.5, 7.5, 123.4, 12_345.6, 2_500_000, 31_000_000].map(fmtCredits)).toEqual(['0', '<0.01', '0.5', '7.5', '123.4', '12,346', '2.5M', '31M']);
    expect(fmtMoney(0.0123)).toBe('$0.012');
    expect(fmtMoney(1234.5, 'EUR')).toBe('€1,235');
    expect([5, 12_345, 2_500_000, 3_200_000_000].map(fmtRows)).toEqual(['5', '12K', '2.5M', '3.2B']);
  });
});

describe('scan estimate', () => {
  const objects = new Map([obj('ssot__Individual__dlm', 'Individual'), obj('ssot__Case__dlm', 'Case')].map((o) => [o.name, o]));
  const counts: Record<string, number> = { ssot__Individual__dlm: 2_500_000 };
  const rowsOf = (n: string) => counts[n];

  it('sums the known objects, flags the unknown ones, and counts a repeated object once', () => {
    const e = estimateScan('SELECT * FROM "ssot__Individual__dlm" a JOIN "ssot__Individual__dlm" b ON 1=1 JOIN "ssot__Case__dlm" c ON 1=1', objects, rowsOf)!;
    expect(e.items.map((i) => i.name)).toEqual(['ssot__Individual__dlm', 'ssot__Case__dlm']);
    expect(e.rows).toBe(2_500_000);
    expect(e.unknown).toBe(1);
    expect(e.complete).toBe(false);
    expect(creditsFor(e.rows, 3)).toBe(7.5);
  });

  it('is complete when everything is known, and null when nothing is recognised', () => {
    expect(estimateScan('SELECT COUNT(*) FROM "ssot__Individual__dlm"', objects, rowsOf)!.complete).toBe(true);
    expect(estimateScan('SELECT 1', objects, rowsOf)).toBeNull();
    expect(estimateScan('SELECT * FROM "Unknown__dlm"', objects, rowsOf)).toBeNull();
  });

  it('ignores names in comments and strings, and notes when a LIMIT may stop the read early', () => {
    expect(estimateScan(`SELECT 'ssot__Case__dlm' -- "ssot__Case__dlm"\nFROM "ssot__Individual__dlm"`, objects, rowsOf)!.items).toHaveLength(1);
    expect(estimateScan('SELECT * FROM "ssot__Individual__dlm" LIMIT 10', objects, rowsOf)!.mayStopEarly).toBe(true);
    expect(estimateScan('SELECT COUNT(*) FROM "ssot__Individual__dlm" LIMIT 10', objects, rowsOf)!.mayStopEarly).toBe(false);
    expect(estimateScan('SELECT * FROM "ssot__Individual__dlm"', objects, rowsOf)!.mayStopEarly).toBe(false);
  });

  it('multiplies a profile by its batches', () => expect(profileRows(1_000_000, 3)).toBe(3_000_000));
});

describe('plan arithmetic', () => {
  const rates = effectiveRates();

  it('computes credits per line, with compounding growth', () => {
    const l = newLine('ingest-batch', { rowsPerRun: 1_000_000, runsPerMonth: 30 });
    expect(lineCredits(l, rates['ingest-batch'], 0)).toBe(60_000); // 1M rows × 2,000 × 30 runs
    expect(lineCredits(l, rates['ingest-batch'], 10, 0)).toBe(60_000);
    expect(lineCredits(l, rates['ingest-batch'], 10, 2)).toBeCloseTo(60_000 * 1.21, 6);
    expect(lineCredits({ ...l, runsPerMonth: 0 }, rates['ingest-batch'], 0)).toBe(0);
  });

  it('summarises by usage type, largest first, and across the horizon', () => {
    const plan = {
      ...emptyPlan('Sizing'),
      months: 3,
      growthPctPerMonth: 100,
      lines: [
        newLine('ingest-batch', { id: 'a', rowsPerRun: 1_000_000, runsPerMonth: 1 }), // 2,000
        newLine('unification', { id: 'b', rowsPerRun: 1_000_000, runsPerMonth: 1 }), // 75,000
        newLine('query', { id: 'c', rowsPerRun: 0, runsPerMonth: 5 }),
      ],
    };
    const s = summarizePlan(plan, rates);
    expect(s.byUsage.map((u) => u.usage)).toEqual(['unification', 'ingest-batch']); // zero lines dropped
    expect(s.byUsage[0]!.share).toBeCloseTo(75_000 / 77_000, 6);
    expect(s.month1).toBe(77_000);
    expect(s.monthly).toEqual([77_000, 154_000, 308_000]); // doubling each month
    expect(s.total).toBe(539_000);
    expect(s.perLine.find((x) => x.id === 'b')).toEqual({ id: 'b', month1: 75_000, total: 525_000 });
  });

  it('uses overridden rates', () => {
    const plan = { ...emptyPlan(), lines: [newLine('unification', { rowsPerRun: 1_000_000, runsPerMonth: 1 })] };
    expect(summarizePlan(plan, effectiveRates({ rates: { unification: 1000 } })).month1).toBe(1000);
  });

  it('clamps whatever comes back from storage', () => {
    expect(sanitizePlan(null)).toBeNull();
    const p = sanitizePlan({
      name: 'x'.repeat(200),
      growthPctPerMonth: 5000,
      months: 999,
      lines: [
        { id: 'ok', usage: 'query', label: 'Q', rowsPerRun: -4, runsPerMonth: 'many', origin: 'org' },
        { usage: 'bogus', label: 'dropped' },
        null,
      ],
    })!;
    expect(p.name).toHaveLength(80);
    expect(p.growthPctPerMonth).toBe(100);
    expect(p.months).toBe(36);
    expect(p.lines).toEqual([{ id: 'ok', usage: 'query', label: 'Q', rowsPerRun: 0, runsPerMonth: 0, origin: 'org' }]);
  });
});

describe('prefill from an org', () => {
  it('reads refresh frequencies and publish intervals, and says when it cannot', () => {
    expect(['DAILY', 'Hourly', 'Weekly', 'MONTHLY', 'TwentyFourHours', 'Fortnightly', undefined].map(runsPerMonthFromFrequency)).toEqual([30, 720, 4, 1, 30, null, null]);
    expect(['NO_REFRESH', 'ONE', 'SIX', 'TWELVE', 'TWENTY_FOUR', 'TWENTYFOUR', 'Mystery', undefined].map(runsPerMonthFromPublishInterval)).toEqual([0, 720, 120, 60, 30, 30, null, null]);
  });

  const streams: StreamInfo[] = [
    { name: 'A', label: 'A', lastProcessedRecords: 1000, totalRecords: 9_000_000, refreshFrequency: 'Hourly', refreshMode: 'UPSERT' },
    { name: 'B', label: 'B', totalRecords: 500 },
  ];
  const segments: SegmentInfo[] = [
    { apiName: 'S1', label: 'S1', publishInterval: 'TWELVE', segmentOn: 'UnifiedIndividual__dlm' },
    { apiName: 'S2', label: 'S2', publishInterval: 'NO_REFRESH' },
    { apiName: 'S3', label: 'S3' },
  ];
  const identity: IdentityRuleset[] = [
    { label: 'Individual Match', sourceProfiles: 4000, totalUnifiedProfiles: 2500, runsAutomatically: true, outputs: [] },
  ];

  it('builds one line per stream, ruleset and segment from what the org reports', () => {
    const lines = prefillLines({ streams, segments, identity, rowsOf: (n) => (n === 'UnifiedIndividual__dlm' ? 3000 : undefined) });
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    // the last run's rows beat the total, and the frequency is read
    expect(byId['org:stream:A']).toMatchObject({ usage: 'ingest-batch', rowsPerRun: 1000, runsPerMonth: 720 });
    expect(byId['org:stream:A']!.note).toContain('upsert');
    // no run info: the total, assumed daily, and it says so
    expect(byId['org:stream:B']).toMatchObject({ rowsPerRun: 500, runsPerMonth: 30 });
    expect(byId['org:stream:B']!.note).toContain('frequency not reported');
    expect(byId['org:identity:Individual Match']).toMatchObject({ usage: 'unification', rowsPerRun: 4000, runsPerMonth: 30 });
    // segment size: the segmented object's count, else unified profiles; not scheduled means no runs
    expect(byId['org:segment:S1']).toMatchObject({ usage: 'segmentation', rowsPerRun: 3000, runsPerMonth: 60 });
    expect(byId['org:segment:S2']).toMatchObject({ rowsPerRun: 2500, runsPerMonth: 0 });
    expect(byId['org:segment:S3']!.runsPerMonth).toBe(30);
    expect(byId['org:segment:S3']!.note).toContain('not reported');
    expect(lines.every((l) => l.origin === 'org')).toBe(true);
  });

  it('replaces org lines on re-read but keeps what the person added', () => {
    const mine = newLine('activation', { id: 'mine', rowsPerRun: 10 });
    const stale = newLine('ingest-batch', { id: 'org:stream:old', origin: 'org' });
    const plan = { ...emptyPlan(), lines: [mine, stale] };
    const next = applyPrefill(plan, prefillLines({ streams, segments: [], identity: [] }));
    expect(next.lines.map((l) => l.id)).toEqual(['mine', 'org:stream:A', 'org:stream:B']);
  });
});

describe('plan export', () => {
  const rates = effectiveRates();
  const plan = { ...emptyPlan('Acme sizing'), months: 2, lines: [newLine('unification', { id: 'u', label: 'Resolution', rowsPerRun: 1_000_000, runsPerMonth: 1, note: 'check me' })] };
  const ctx = { host: 'acme.my.salesforce.com', dataspace: 'default', at: new Date('2026-10-07T12:00:00Z'), preparedBy: 'jane@publicis.com' };

  it('states the org, the assumptions and that the rates are unverified', () => {
    const [about, byUsage, lines, projection, card] = planTables(plan, summarizePlan(plan, rates), rates, undefined, ctx);
    const text = JSON.stringify(about!.rows);
    expect(text).toContain('acme.my.salesforce.com');
    expect(text).toContain('UNVERIFIED defaults');
    expect(text).toContain('not a quote');
    expect(text).toContain('Storage');
    expect(byUsage!.rows).toEqual([['Identity unification', 75000, 75000, 100]]);
    expect(lines!.rows[0]).toEqual(['Identity unification', 'Resolution', 1_000_000, 1, 75000, 75000, 150000, 'Entered', 'check me']);
    expect(projection!.rows).toEqual([[1, 75000], [2, 75000]]);
    expect(card!.rows.find((r) => r[0] === 'Data queries')).toEqual(['Data queries', 3, 3, null, 'rows read by a query', null]);
  });

  it('adds cost columns only when a price is set, and drops the warning once confirmed', () => {
    const o = { pricePerCredit: 0.005, currency: 'USD', confirmed: true, rates: { query: 2 } };
    const r = effectiveRates(o);
    const tables = planTables(plan, summarizePlan(plan, r), r, o, ctx);
    expect(tables[1]!.header).toContain('Cost (USD)');
    expect(tables[1]!.rows[0]).toContain(375);
    expect(JSON.stringify(tables[0]!.rows)).toContain('Confirmed against the customer contract');
    expect(JSON.stringify(tables[0]!.rows)).not.toContain('UNVERIFIED');
    expect(tables[4]!.rows.find((x) => x[0] === 'Data queries')).toEqual(['Data queries', 2, 3, 'yes', 'rows read by a query', null]);
  });
});

describe('publish interval wording', () => {
  it('reads the interval in plain words', async () => {
    const { describePublishInterval } = await import('../shared/plan');
    expect(['ONE', 'SIX', 'TWELVE', 'TWENTY_FOUR', 'NO_REFRESH', 'Streaming', undefined].map(describePublishInterval)).toEqual([
      'every hour', 'every 6 hours', 'every 12 hours', 'every 24 hours', 'not scheduled', 'streaming', 'unknown',
    ]);
  });
});

describe('typing row counts', () => {
  it('accepts the shorthand people use, and rejects the rest', async () => {
    const { parseRows } = await import('../shared/credits');
    expect(['2500000', '2,500,000', '2.5m', '2.5 M', '500k', '1.2B', '0', '.5k', ' 12 '].map(parseRows)).toEqual([2_500_000, 2_500_000, 2_500_000, 2_500_000, 500_000, 1_200_000_000, 0, 500, 12]);
    expect(['', 'lots', '-5', '1e6', '5x', '2.5.1', '99999999999999m'].map(parseRows)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe('sanitizing stored rate overrides', () => {
  it('keeps sane values, drops the rest, and tolerates garbage', async () => {
    const { sanitizeOverrides } = await import('../shared/credits');
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides('x')).toEqual({});
    expect(
      sanitizeOverrides({ rates: { query: 2, unification: -1, bogus: 5, activation: 'many' }, pricePerCredit: 0.004, currency: 'eur', confirmed: true }),
    ).toEqual({ rates: { query: 2 }, pricePerCredit: 0.004, currency: 'EUR', confirmed: true });
    expect(sanitizeOverrides({ pricePerCredit: 0, currency: 'dollars', confirmed: 'yes' })).toEqual({});
  });
});
