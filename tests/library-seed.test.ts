import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../server/data360/mock/client';
import { toSqlParameters } from '../shared/sql';
import { loadLibrary } from '../vite-plugin-library';

const entries = loadLibrary(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const client = createMockClient();

describe('seed query library', () => {
  it('has entries', () => expect(entries.length).toBeGreaterThan(0));

  it.each(entries.map((e) => [e.id, e] as const))('%s runs against the mock with its defaults', async (_id, e) => {
    const params = toSqlParameters(e.sql, e.params, {});
    const res = await client.submitQuery({ sql: e.sql, dataspace: e.dataspace ?? 'default', params });
    expect(res.columns?.length).toBeGreaterThan(0);
    expect(res.rows.length).toBeGreaterThan(0);
  });
});

describe('identity resolution queries against the mock', () => {
  const run = async (id: string) => {
    const e = entries.find((x) => x.id === id)!;
    return client.submitQuery({ sql: e.sql, dataspace: 'default', params: toSqlParameters(e.sql, e.params, {}) });
  };

  it('agree with each other: cluster sizes add up to the linked source profiles', async () => {
    const [source, unified, rate] = (await run('identity/consolidation-rate')).rows[0] as number[];
    expect(source).toBe(2500);
    expect(unified).toBeLessThan(source!);
    expect(rate).toBeCloseTo(1 - unified! / source!, 3);
    const dist = (await run('identity/cluster-size-distribution')).rows as number[][];
    expect(dist.reduce((n, r) => n + r[2]!, 0)).toBe(source);
    expect(dist.reduce((n, r) => n + r[1]!, 0)).toBe(unified);
    expect((await run('identity/unlinked-individuals')).rows).toEqual([[0]]);
    const big = (await run('identity/largest-clusters')).rows as number[][];
    expect(big.every((r) => r[1]! >= 3)).toBe(true);
    // The data source comes from the joined source individual, so every linked profile is counted once.
    const bySource = (await run('identity/profiles-by-source')).rows as [string, number, number][];
    expect(bySource.reduce((n, r) => n + r[1], 0)).toBe(source);
    expect(bySource.every((r) => r[2] <= r[1])).toBe(true);
    // Some unified profiles combine records from different sources; each pair is listed once, in order.
    const overlap = (await run('identity/source-overlap')).rows as [string, string, number][];
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlap.every(([a, b]) => a < b)).toBe(true);
    expect(new Set(overlap.map(([a, b]) => `${a}|${b}`)).size).toBe(overlap.length);
  });
});
