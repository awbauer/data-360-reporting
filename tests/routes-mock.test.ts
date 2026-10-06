import { beforeAll, describe, expect, it } from 'vitest';
import { cookieJar, H, mockApp } from './helpers';

const app = mockApp();
const jar = cookieJar();
const req = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), cookie: jar.header() } });

beforeAll(async () => {
  jar.absorb(await app.request('/auth/login'));
});

describe('mock mode API', () => {
  it('rejects unauthenticated API calls', async () => {
    const res = await app.request('/api/dataspaces');
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('not_connected');
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
    jar.absorb(res);
    expect((await req('/api/dataspaces')).status).toBe(401);
  });
});
