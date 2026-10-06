import { describe, expect, it } from 'vitest';
import {
  buildProfileBatches,
  buildTopValuesSql,
  findParams,
  parseProfileRows,
  quoteIdent,
  toSqlParameters,
} from '@shared/sql';
import type { FieldMeta } from '@shared/types';

const f = (name: string, type = 'STRING'): FieldMeta => ({ name, label: name, type, isPk: false });

describe('quoteIdent', () => {
  it('quotes and doubles embedded quotes', () => {
    expect(quoteIdent('ssot__Individual__dlm')).toBe('"ssot__Individual__dlm"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
  it('rejects empty names', () => expect(() => quoteIdent('')).toThrow());
});

describe('findParams', () => {
  it('finds params in first-use order, unique', () => {
    expect(findParams('SELECT * FROM t WHERE a = :b AND c = :a AND d = :b')).toEqual(['b', 'a']);
  });
  it('ignores casts, strings, identifiers and comments', () => {
    const sql = `SELECT x::int, 'a :no', E'it\\'s :no', "col:no", $$ :no $$ -- :no
      /* :no */ FROM t WHERE y = :yes`;
    expect(findParams(sql)).toEqual(['yes']);
  });
  it('handles doubled quotes inside strings', () => {
    expect(findParams(`SELECT 'it''s :no' , :yes`)).toEqual(['yes']);
  });
  it('does not treat times as params', () => {
    expect(findParams(`SELECT '10:30', a FROM t WHERE x = :p`)).toEqual(['p']);
  });
});

describe('toSqlParameters', () => {
  it('maps types, applies defaults, and keeps values as strings', () => {
    const out = toSqlParameters(
      'SELECT :n, :d, :s, :b',
      [
        { name: 'n', type: 'integer' },
        { name: 'd', type: 'date', default: '2025-01-31' },
        { name: 's', type: 'string' },
        { name: 'b', type: 'boolean' },
      ],
      { n: '42', s: '', b: 'TRUE' },
    );
    expect(out).toEqual([
      { name: 'n', type: 'BigInt', value: '42' },
      { name: 'd', type: 'Date', value: '2025-01-31' },
      { name: 's', type: 'Varchar', value: '' },
      { name: 'b', type: 'Bool', value: 'true' },
    ]);
  });
  it('treats undeclared params as strings', () => {
    expect(toSqlParameters('SELECT :x', [], { x: 'hi' })).toEqual([{ name: 'x', type: 'Varchar', value: 'hi' }]);
  });
  it.each([
    ['integer', '4.5'],
    ['number', 'abc'],
    ['boolean', 'yes'],
    ['date', '2025-02-30'],
    ['timestamp', 'yesterday'],
  ] as const)('rejects bad %s %s', (type, value) => {
    expect(() => toSqlParameters('SELECT :p', [{ name: 'p', type }], { p: value })).toThrow(/"p"/);
  });
  it('throws when a value is missing', () => {
    expect(() => toSqlParameters('SELECT :p', [{ name: 'p', type: 'integer' }], {})).toThrow(/Missing/);
  });
});

describe('profile SQL', () => {
  it('builds aliased aggregates with min/max only for orderable types', () => {
    const [b] = buildProfileBatches({ name: 'T__dlm', fields: [f('a'), f('b', 'NUMBER')] });
    expect(b!.sql).toBe(
      'SELECT COUNT(*) AS "rows", COUNT("a") AS "nn_0", APPROX_COUNT_DISTINCT("a") AS "nd_0", ' +
        'COUNT("b") AS "nn_1", APPROX_COUNT_DISTINCT("b") AS "nd_1", MIN("b") AS "min_1", MAX("b") AS "max_1" FROM "T__dlm"',
    );
  });
  it('splits wide objects into batches with unique aliases', () => {
    const fields = Array.from({ length: 130 }, (_, i) => f(`f${i}`));
    const batches = buildProfileBatches({ name: 'T', fields });
    expect(batches).toHaveLength(3);
    expect(batches[2]!.sql).toContain('"nn_129"');
  });
  it('parses results positionally across batches', () => {
    const fields = [f('a'), f('b', 'NUMBER')];
    const batches = buildProfileBatches({ name: 'T', fields }, 1);
    const p = parseProfileRows(batches, [[100, 90, 10], [100, 100, 100, 1, 9]]);
    expect(p.rows).toBe(100);
    expect(p.fields.a).toMatchObject({ nonNull: 90, distinct: 10 });
    expect(p.fields.a!.nullRate).toBeCloseTo(0.1);
    expect(p.fields.b).toMatchObject({ distinct: 100, min: 1, max: 9 });
  });
  it('quotes the field in top-values SQL', () => {
    expect(buildTopValuesSql({ name: 'T' }, 'we"ird', 5)).toBe(
      'SELECT "we""ird" AS "value", COUNT(*) AS "count" FROM "T" GROUP BY "we""ird" ORDER BY "count" DESC LIMIT 5',
    );
  });
});
