import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildDateHistogramSql,
  buildNumericHistogramSql,
  buildRangeSql,
  chooseDateUnit,
  chooseNumericBuckets,
  dateBars,
  numericBars,
  parseRange,
} from '@shared/histogram';
import { cookieJar, H, mockApp } from './helpers';

const { app, send, signIn } = mockApp();
const jar = cookieJar();
const req = (path: string, init: RequestInit = {}) => send(jar, path, init);

beforeAll(async () => {
  await signIn(jar, 'demo@example.com', false);
  await req('/auth/login');
});

describe('mock mode API', () => {
  it('rejects API calls from someone not signed in to the app', async () => {
    const res = await app.request('/api/dataspaces');
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthenticated');
    const login = await app.request('/auth/login');
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toMatch(/^\/\?error=Sign/);
  });

  it('reports the session', async () => {
    const body = await (await req('/api/session')).json();
    expect(body).toMatchObject({ connected: true, mock: true });
  });

  it('lists data spaces and metadata with all three kinds', async () => {
    const spaces = await (await req('/api/dataspaces')).json();
    expect(spaces.map((s: { name: string }) => s.name)).toEqual(['default', 'marketing']);
    const { objects } = await (await req('/api/metadata?dataspace=default')).json();
    const kinds = new Set(objects.map((o: { kind: string }) => o.kind));
    expect(kinds).toEqual(new Set(['dmo', 'dlo', 'ci']));
    const ci = objects.find((o: { kind: string }) => o.kind === 'ci');
    expect(ci.fields.map((f: { role: string }) => f.role)).toEqual(['dimension', 'dimension', 'measure']);
    const ind = objects.find((o: { name: string }) => o.name === 'ssot__Individual__dlm');
    expect(ind.fields.find((f: { name: string }) => f.name === 'ssot__Id__c').isPk).toBe(true);
  });

  it('rejects invalid data space names', async () => {
    expect((await req('/api/metadata?dataspace=a/../b')).status).toBe(400);
  });

  it('runs a parameterised query', async () => {
    const res = await req('/api/query', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        sql: 'SELECT "ssot__Id__c" FROM "ssot__Individual__dlm" WHERE "ssot__YearlyIncome__c" > :min ORDER BY 1 LIMIT :n',
        paramDefs: [{ name: 'min', type: 'integer' }, { name: 'n', type: 'integer' }],
        params: { min: '100000', n: '5' },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(5);
    expect(body.columns[0].name).toBe('ssot__Id__c');
    expect(body.done).toBe(true);
  });

  it('pages large results and exercises polling', async () => {
    const res = await req('/api/query', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ sql: 'SELECT * FROM "ssot__EmailEngagement__dlm"' }),
    });
    const q = await res.json();
    expect(q.rows).toHaveLength(1000);
    expect(q.rowCount).toBe(5000);
    expect(q.done).toBe(false);
    const id = encodeURIComponent(q.queryId);
    expect((await req(`/api/query/${id}/rows?offset=1000&limit=10`)).status).toBe(400); // still running
    let st = await (await req(`/api/query/${id}`)).json();
    while (!st.done) st = await (await req(`/api/query/${id}`)).json();
    const page = await (await req(`/api/query/${id}/rows?offset=4990&limit=100`)).json();
    expect(page.rows).toHaveLength(10);
  });

  it('streams a CSV export with a header row', async () => {
    const q = await (
      await req('/api/query', { method: 'POST', headers: H, body: JSON.stringify({ sql: 'SELECT "ssot__Id__c", "ssot__Subject__c" FROM "ssot__Case__dlm" ORDER BY 1 LIMIT 3' }) })
    ).json();
    const res = await req(`/api/query/${encodeURIComponent(q.queryId)}/export.csv`);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const lines = (await res.text()).trim().split('\n');
    expect(lines[0]).toBe('ssot__Id__c,ssot__Subject__c');
    expect(lines).toHaveLength(4);
  });

  it('surfaces SQL errors as 400 with a message', async () => {
    const res = await req('/api/query', { method: 'POST', headers: H, body: JSON.stringify({ sql: 'SELECT * FROM nope' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/no such table/);
  });

  it('reports bad parameter values as 400', async () => {
    const res = await req('/api/query', {
      method: 'POST', headers: H,
      body: JSON.stringify({ sql: 'SELECT :n', paramDefs: [{ name: 'n', type: 'integer' }], params: { n: 'x' } }),
    });
    expect(res.status).toBe(400);
  });

  it('requires the CSRF header on mutations', async () => {
    const res = await req('/api/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(403);
  });

  it('rejects malformed query ids', async () => {
    expect((await req('/api/query/..%2F..%2Fetc')).status).toBe(400);
  });

  it('logs out', async () => {
    const res = await req('/auth/logout', { method: 'POST', headers: H });
    expect(res.status).toBe(200);
    const after = await req('/api/dataspaces');
    expect(after.status).toBe(401);
    expect((await after.json()).error).toBe('not_connected');
  });
});

describe('mock mode: extras and histograms', () => {
  const local = mockApp();
  const j = cookieJar();
  const r = (path: string, init: RequestInit = {}) => local.send(j, path, init);
  const run = async (sql: string) => (await r('/api/query', { method: 'POST', headers: H, body: JSON.stringify({ sql }) })).json();

  beforeAll(async () => {
    await local.signIn(j, 'demo@example.com', false);
    await r('/auth/login');
  });

  it('lists data streams and segments', async () => {
    const x = await (await r('/api/extras?dataspace=default')).json();
    expect(x.errors).toEqual([]);
    expect(x.dataStreams.total).toBe(3);
    expect(x.segments.items.map((s: { apiName: string }) => s.apiName)).toContain('Lapsed_VIPs');
  });

  it('runs the generated range, numeric-histogram and date-histogram SQL', async () => {
    const obj = { name: 'ssot__Individual__dlm' };
    const range = await run(buildRangeSql(obj, 'ssot__YearlyIncome__c'));
    const { min, max, nonNull, total } = parseRange(range.rows[0]);
    expect(total).toBe(2500);
    expect(nonNull).toBeLessThan(total); // nulls exist in the fixture
    const b = chooseNumericBuckets(Number(min), Number(max));
    const hist = await run(buildNumericHistogramSql(obj, 'ssot__YearlyIncome__c', b));
    expect(hist.error).toBeUndefined();
    const bars = numericBars(b, hist.rows);
    expect(bars.reduce((n, x) => n + x.value, 0)).toBe(nonNull);

    const drange = parseRange((await run(buildRangeSql(obj, 'ssot__CreatedDate__c'))).rows[0]);
    const unit = chooseDateUnit(drange.min, drange.max);
    const dh = await run(buildDateHistogramSql(obj, 'ssot__CreatedDate__c', unit));
    expect(dh.error).toBeUndefined();
    const dbars = dateBars(drange.min, drange.max, unit, dh.rows);
    expect(dbars.reduce((n, x) => n + x.value, 0)).toBe(drange.nonNull);
  });
});
