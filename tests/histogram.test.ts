import { describe, expect, it } from 'vitest';
import {
  buildDateHistogramSql,
  buildNumericHistogramSql,
  chooseDateUnit,
  chooseNumericBuckets,
  dateBars,
  numericBars,
  truncate,
} from '@shared/histogram';
import { analyzeQuery, withLimit } from '@shared/sqlcheck';

describe('numeric buckets', () => {
  it('uses one bucket per integer for small ranges', () => {
    expect(chooseNumericBuckets(1, 10)).toEqual({ lo: 1, step: 1, count: 10 });
  });
  it('handles a single value', () => {
    expect(chooseNumericBuckets(7, 7)).toEqual({ lo: 7, step: 1, count: 1 });
  });
  it('picks a nice step that covers the range', () => {
    const b = chooseNumericBuckets(30_123, 149_987);
    expect(b.step).toBe(10_000);
    expect(b.lo).toBe(30_000);
    expect(b.lo + b.count * b.step).toBeGreaterThan(149_987);
    expect(b.count).toBeLessThanOrEqual(21);
  });
  it('copes with fractions without float noise', () => {
    const b = chooseNumericBuckets(0.01, 0.31);
    expect(b.step).toBe(0.02);
    expect(String(b.lo)).not.toMatch(/0000|9999/);
  });
  it('handles negatives', () => {
    const b = chooseNumericBuckets(-95, 105);
    expect(b.lo).toBeLessThanOrEqual(-95);
    expect(b.lo + b.count * b.step).toBeGreaterThan(105);
  });
  it('rejects bad ranges', () => {
    expect(() => chooseNumericBuckets(5, 1)).toThrow(RangeError);
    expect(() => chooseNumericBuckets(NaN, 1)).toThrow(RangeError);
  });
  it('builds SQL that casts before dividing and quotes names', () => {
    expect(buildNumericHistogramSql({ name: 'T' }, 'we"ird', { lo: -10, step: 2.5, count: 4 })).toBe(
      'SELECT FLOOR((CAST("we""ird" AS DOUBLE PRECISION) - -10) / 2.5) AS "bucket", COUNT(*) AS "count" ' +
        'FROM "T" WHERE "we""ird" IS NOT NULL GROUP BY 1 ORDER BY 1',
    );
  });
  it('fills empty buckets and clamps strays into range', () => {
    const bars = numericBars({ lo: 0, step: 10, count: 4 }, [[0, 5], [2, 3], [9, 1]]);
    expect(bars.map((b) => b.value)).toEqual([5, 0, 3, 1]);
    expect(bars[0]!.label).toBe('0');
    expect(bars[1]!.title).toContain('10 to <20');
  });
});

describe('date buckets', () => {
  it.each([
    ['2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', 'hour'],
    ['2024-01-01', '2024-02-01', 'day'],
    ['2024-01-01', '2024-09-01', 'week'],
    ['2022-01-01', '2024-06-01', 'month'],
    ['2015-01-01', '2024-06-01', 'quarter'],
    ['1990-01-01', '2024-06-01', 'year'],
  ] as const)('%s..%s → %s', (a, b, unit) => expect(chooseDateUnit(a, b)).toBe(unit));

  it('rejects a reversed range', () => expect(() => chooseDateUnit('2024-02-01', '2024-01-01')).toThrow(RangeError));

  it('builds date_trunc SQL for known units only', () => {
    expect(buildDateHistogramSql({ name: 'T' }, 'd', 'month')).toBe(
      `SELECT DATE_TRUNC('month', "d") AS "bucket", COUNT(*) AS "count" FROM "T" WHERE "d" IS NOT NULL GROUP BY 1 ORDER BY 1`,
    );
    expect(() => buildDateHistogramSql({ name: 'T' }, 'd', "month') --" as never)).toThrow(RangeError);
  });

  it('truncates weeks to Monday and quarters to their first month', () => {
    expect(new Date(truncate(Date.parse('2024-05-16T10:00:00Z'), 'week')).toISOString()).toBe('2024-05-13T00:00:00.000Z');
    expect(new Date(truncate(Date.parse('2024-05-16T10:00:00Z'), 'quarter')).toISOString()).toBe('2024-04-01T00:00:00.000Z');
  });

  it('includes empty months and tolerates +00:00 and bare-date results', () => {
    const bars = dateBars('2024-01-15', '2024-04-02', 'month', [
      ['2024-01-01T00:00:00+00:00', 4],
      ['2024-04-01 00:00:00', 1],
    ]);
    expect(bars.map((b) => [b.label, b.value])).toEqual([['2024-01', 4], ['2024-02', 0], ['2024-03', 0], ['2024-04', 1]]);
  });
});

describe('analyzeQuery', () => {
  const a = (s: string) => analyzeQuery(s);
  it('flags unbounded SELECT * and plain selects', () => {
    expect(a('SELECT * FROM "T"')).toMatchObject({ unbounded: true, selectStar: true });
    expect(a('SELECT x.* FROM "T" x')).toMatchObject({ unbounded: true, selectStar: true });
    expect(a('SELECT "a", "b" FROM "T"')).toMatchObject({ unbounded: true, selectStar: false });
  });
  it('does not flag bounded or summarising queries', () => {
    expect(a('SELECT * FROM "T" LIMIT 10').unbounded).toBe(false);
    expect(a('SELECT * FROM "T" LIMIT :n').unbounded).toBe(false);
    expect(a('SELECT COUNT(*) FROM "T"').unbounded).toBe(false);
    expect(a('SELECT "a", COUNT(*) FROM "T" GROUP BY 1').unbounded).toBe(false);
    expect(a('SELECT DISTINCT "a" FROM "T"').unbounded).toBe(false);
  });
  it('is not fooled by keywords inside strings, comments or identifiers', () => {
    expect(a(`SELECT "a" FROM "T" -- LIMIT 5`).unbounded).toBe(true);
    expect(a(`SELECT 'LIMIT 5' AS x FROM "T"`).unbounded).toBe(true);
    expect(a(`SELECT "LIMIT 5", 1 FROM "T"`).unbounded).toBe(true);
    expect(a(`SELECT * FROM "T" /* count(*) */`).unbounded).toBe(true);
    expect(a('SELECT * FROM "T" LIMIT ALL').unbounded).toBe(true);
  });
  it('reports referenced quoted identifiers and ignores non-selects', () => {
    expect(a('SELECT "a" FROM "My ""Obj"""').idents).toEqual(['a', 'My "Obj"']);
    expect(a('EXPLAIN SELECT * FROM "T"').isSelect).toBe(false);
  });
  it('appends a LIMIT safely', () => {
    expect(withLimit('SELECT 1 FROM "T";  ', 50)).toBe('SELECT 1 FROM "T"\nLIMIT 50');
    expect(withLimit('SELECT 1 -- note', 5)).toBe('SELECT 1 -- note\nLIMIT 5');
  });
});

import { buildJoinSql, cardinalityText, neighbours } from '@shared/join';
import type { ObjectMeta } from '@shared/types';

const f = (name: string, extra: Partial<ObjectMeta['fields'][number]> = {}) => ({ name, label: name, type: 'STRING', isPk: false, ...extra });
const obj = (name: string, fields: ObjectMeta['fields']): ObjectMeta => ({ name, label: name, kind: 'dmo', category: 'Profile', fields, primaryKeys: [], relationships: [] });

describe('join builder', () => {
  const email = obj('Email__dlm', [f('KQ_Id__c'), f('Addr__c'), f('Party__c'), f('Id__c', { isPk: true }), f('x1'), f('x2')]);
  const ind = obj('Ind__dlm', [f('Name__c'), f('Id__c', { isPk: true })]);
  const rel = { fromEntity: 'Email__dlm', toEntity: 'Ind__dlm', fromEntityAttribute: 'Party__c', toEntityAttribute: 'Id__c', cardinality: 'NTOONE' };

  it('puts join and primary keys first, limits columns, aliases both sides, and quotes names', () => {
    const sql = buildJoinSql(email, ind, rel)!;
    expect(sql).toContain('a."Party__c" AS "a.Party__c"');
    expect(sql.indexOf('"a.Party__c"')).toBeLessThan(sql.indexOf('"a.Id__c"'));
    expect(sql).not.toContain('"a.KQ_Id__c"'); // key-qualifier plumbing ranks last, beyond five per side
    expect(sql).toContain('FROM "Email__dlm" a\nJOIN "Ind__dlm" b ON a."Party__c" = b."Id__c"\nLIMIT 100');
  });
  it('returns null when a field is missing or unknown', () => {
    expect(buildJoinSql(email, ind, { ...rel, toEntityAttribute: 'Nope__c' })).toBeNull();
    expect(buildJoinSql(email, ind, { fromEntity: 'a', toEntity: 'b' })).toBeNull();
  });
  it('merges parallel relationships and skips self-references', () => {
    const e = neighbours('A', [
      { fromEntity: 'A', toEntity: 'B', fromEntityAttribute: 'x', toEntityAttribute: 'y' },
      { fromEntity: 'A', toEntity: 'B', fromEntityAttribute: 'x', toEntityAttribute: 'y' },
      { fromEntity: 'C', toEntity: 'A', fromEntityAttribute: 'p', toEntityAttribute: 'q' },
      { fromEntity: 'A', toEntity: 'A', fromEntityAttribute: 'm', toEntityAttribute: 'n' },
    ]);
    expect(e.map((x) => [x.other, x.rels.length])).toEqual([['B', 1], ['C', 1]]);
    expect(cardinalityText('NTOONE')).toBe('N:1');
  });
});
