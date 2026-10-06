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
