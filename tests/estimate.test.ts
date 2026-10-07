import { describe, expect, it } from 'vitest';
import { FLEX_2026_06 } from '../shared/credits';
import { QUERY_CREDITS_PER_MILLION, creditsFor, estimateScan, fmtEstCredits, fmtRows, profileRows } from '../shared/estimate';
import { describePublishInterval } from '../shared/schedule';
import type { ObjectMeta } from '../shared/types';

const obj = (name: string, label = name): ObjectMeta => ({ name, label, kind: 'dmo', category: 'Profile', fields: [], primaryKeys: [], relationships: [] });

describe('query credits', () => {
  it('use the base-tier Flex rate for Data 360 Queries', () => {
    expect(QUERY_CREDITS_PER_MILLION).toBe(FLEX_2026_06.usageTypes.queries!.production[0]);
  });

  it('turn rows into credits and format them', () => {
    expect(creditsFor(100_000_000)).toBe(300);
    expect(creditsFor(0)).toBe(0);
    expect([0, 0.004, 0.5, 7.5, 123.4, 12_345.6, 2_500_000, 31_000_000].map(fmtEstCredits)).toEqual(['0', '<0.01', '0.5', '7.5', '123.4', '12,346', '2.5M', '31M']);
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
    expect(creditsFor(e.rows)).toBe(7.5);
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

describe('publish interval wording', () => {
  it('reads the interval in plain words', () => {
    expect(['ONE', 'SIX', 'TWELVE', 'TWENTY_FOUR', 'NO_REFRESH', 'Streaming', undefined].map(describePublishInterval)).toEqual([
      'every hour', 'every 6 hours', 'every 12 hours', 'every 24 hours', 'not scheduled', 'streaming', 'unknown',
    ]);
  });
});
