import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../server/oauth';
import { cookieJar, H, realApp } from './helpers';

const INSTANCE = 'https://acme.my.salesforce.com';
const API = `${INSTANCE}/services/data/v65.0/ssot`;

interface Call { url: string; method: string; headers: Record<string, string>; body: string }

function fakeSalesforce(handlers: (call: Call, calls: Call[]) => Response | undefined) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = { url, method: init?.method ?? 'GET', headers, body: String(init?.body ?? '') };
    calls.push(call);
    const res = handlers(call, calls);
    if (!res) throw new Error(`Unexpected fetch: ${call.method} ${url}`);
    return res;
  };
  return { fetchFn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const tokenOk = (over: Record<string, unknown> = {}) =>
  json({ access_token: 'AT1', refresh_token: 'RT1', instance_url: INSTANCE, ...over });

type App = ReturnType<typeof realApp>;

/** POST /auth/credentials, returning the app, the cookie jar holding the credentials cookie, and the JSON reply. */
async function withCredentials(fetchFn: FetchLike, body: Record<string, unknown>) {
  const app = realApp(fetchFn);
  const jar = cookieJar();
  const res = await app.request('/auth/credentials', { method: 'POST', headers: H, body: JSON.stringify(body) });
  expect(res.status).toBe(200);
  jar.absorb(res);
  return { app, jar, prepare: (await res.json()) as Record<string, unknown> };
}

/** Run /auth/login then /auth/callback with whatever cookies the jar holds. */
async function finishLogin(app: App, jar: ReturnType<typeof cookieJar>) {
  const login = await app.request('/auth/login', { headers: { cookie: jar.header() } });
  jar.absorb(login);
  const state = new URL(login.headers.get('location')!).searchParams.get('state');
  const cb = await app.request(`/auth/callback?code=CODE&state=${state}`, { headers: { cookie: jar.header() } });
  jar.absorb(cb);
  return { login, cb };
}

async function connect(fetchFn: FetchLike, query = '') {
  const app = realApp(fetchFn);
  const jar = cookieJar();
  const login = await app.request(`/auth/login${query}`);
  jar.absorb(login);
  const loc = new URL(login.headers.get('location')!);
  const cb = await app.request(`/auth/callback?code=CODE&state=${loc.searchParams.get('state')}`, { headers: { cookie: jar.header() } });
  jar.absorb(cb);
  const req = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), cookie: jar.header() } });
  return { app, jar, login, loc, cb, req };
}

describe('OAuth', () => {
  it('redirects to authorize with PKCE, state and the configured scopes', async () => {
    const { fetchFn } = fakeSalesforce(() => undefined);
    const app = realApp(fetchFn);
    const res = await app.request('/auth/login');
    expect(res.status).toBe(302);
    const u = new URL(res.headers.get('location')!);
    expect(u.origin + u.pathname).toBe('https://login.salesforce.com/services/oauth2/authorize');
    expect(u.searchParams.get('client_id')).toBe('CLIENTID1234567890');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(u.searchParams.get('redirect_uri')).toBe('https://wb.example.com/auth/callback');
    expect(u.searchParams.get('scope')).toBe('api refresh_token cdp_query_api cdp_profile_api');
    const cookie = res.headers.getSetCookie().join('\n');
    expect(cookie).toMatch(/d360_oauth=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('uses the sandbox login host and rejects non-Salesforce custom domains', async () => {
    const { fetchFn } = fakeSalesforce(() => undefined);
    const app = realApp(fetchFn);
    const sb = await app.request('/auth/login?env=sandbox');
    expect(sb.headers.get('location')).toMatch(/^https:\/\/test\.salesforce\.com\//);
    const evil = await app.request('/auth/login?env=custom&domain=evil.example.com');
    expect(evil.headers.get('location')).toMatch(/^\/\?error=/);
    expect(evil.headers.getSetCookie().join()).not.toMatch(/d360_oauth/);
  });

  it('exchanges the code with the verifier and secret, then sets a session', async () => {
    const { fetchFn, calls } = fakeSalesforce((c) => (c.url.endsWith('/services/oauth2/token') ? tokenOk() : undefined));
    const { cb, req, jar } = await connect(fetchFn);
    expect(cb.headers.get('location')).toBe('/');
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('CODE');
    expect(body.get('code_verifier')).toMatch(/^[\w-]{40,}$/);
    expect(body.get('client_secret')).toBe('sekret');
    expect(jar.has('d360_oauth')).toBe(false); // transaction cookie consumed
    expect(await (await req('/api/session')).json()).toMatchObject({ connected: true, instanceHost: 'acme.my.salesforce.com' });
  });

  it('never sends the app secret with a user-supplied consumer key', async () => {
    const { fetchFn, calls } = fakeSalesforce((c) => (c.url.endsWith('/services/oauth2/token') ? tokenOk() : undefined));
    const { app, jar } = await withCredentials(fetchFn, { clientId: 'OTHERKEY1234567890' });
    await finishLogin(app, jar);
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get('client_id')).toBe('OTHERKEY1234567890');
    expect(body.has('client_secret')).toBe(false);
  });

  it('uses a user-supplied secret for the exchange and for refresh, never exposing it', async () => {
    const { fetchFn, calls } = fakeSalesforce((c) => {
      if (c.url.endsWith('/services/oauth2/token')) return c.body.includes('refresh_token=') ? json({ access_token: 'AT2', instance_url: INSTANCE }) : tokenOk();
      if (c.url.includes('/data-spaces')) return c.headers.authorization === 'Bearer AT2' ? json({ dataSpaces: [] }) : json([{ errorCode: 'INVALID_SESSION_ID' }], 401);
      return undefined;
    });
    const { app, jar, prepare } = await withCredentials(fetchFn, { clientId: 'USERKEY12345678', clientSecret: 'user-secret-value' });
    expect(JSON.stringify(prepare)).not.toContain('user-secret-value');
    expect(prepare).toEqual({ clientId: 'USERKEY12345678', hasSecret: true });
    const { cb } = await finishLogin(app, jar);
    expect(cb.headers.get('location')).toBe('/');
    expect(new URLSearchParams(calls[0]!.body).get('client_secret')).toBe('user-secret-value');
    // Nothing readable in any cookie we handed out.
    expect(jar.header()).not.toContain('user-secret-value');
    await app.request('/api/dataspaces', { headers: { cookie: jar.header() } }); // 401 → refresh
    const refresh = calls.find((c) => c.body.includes('grant_type=refresh_token'))!;
    expect(new URLSearchParams(refresh.body).get('client_secret')).toBe('user-secret-value');
  });

  it('never puts credentials in the login URL and consumes the credentials cookie', async () => {
    const { fetchFn } = fakeSalesforce(() => tokenOk());
    const { app, jar } = await withCredentials(fetchFn, { clientId: 'USERKEY12345678', clientSecret: 'user-secret-value' });
    const login = await app.request('/auth/login', { headers: { cookie: jar.header() } });
    jar.absorb(login);
    expect(login.headers.get('location')).not.toContain('user-secret-value');
    expect(jar.has('d360_cred')).toBe(false);
  });

  it('saves remembered credentials encrypted in the database, and uses them by id later', async () => {
    const { fetchFn, calls } = fakeSalesforce((c) => (c.url.endsWith('/services/oauth2/token') ? tokenOk() : undefined));
    const { app, prepare } = await withCredentials(fetchFn, { clientId: 'USERKEY12345678', clientSecret: 'user-secret-value', remember: true, label: 'Acme prod' });
    const savedId = (prepare as { savedId: string }).savedId;
    expect(savedId).toMatch(/^[0-9a-f-]{36}$/);
    const row = await app.db.prepare('select * from sf_credentials where id = ?').bind(savedId).first<Record<string, string>>();
    expect(row!.label).toBe('Acme prod');
    expect(JSON.stringify(row)).not.toContain('user-secret-value');
    const list = await (await app.request('/api/credentials')).json();
    expect(list).toMatchObject([{ id: savedId, label: 'Acme prod', clientId: 'USERKEY12345678', hasSecret: true }]);
    expect(JSON.stringify(list)).not.toContain('user-secret');
    // A later visit presents only the id.
    const jar = cookieJar();
    const res = await app.request('/auth/credentials', { method: 'POST', headers: H, body: JSON.stringify({ savedId }) });
    jar.absorb(res);
    expect(await res.json()).toEqual({ clientId: 'USERKEY12345678', hasSecret: true, savedId });
    await finishLogin(app, jar);
    expect(new URLSearchParams(calls[0]!.body).get('client_secret')).toBe('user-secret-value');
  });

  it("keeps saved credentials per user, and can't decrypt a secret moved to another row or key", async () => {
    const { fetchFn } = fakeSalesforce(() => tokenOk());
    const { app, prepare } = await withCredentials(fetchFn, { clientId: 'USERKEY12345678', clientSecret: 'user-secret-value', remember: true });
    const savedId = (prepare as { savedId: string }).savedId;
    // Another user of the same deployment can neither see nor use it.
    const bob = cookieJar();
    await app.signIn(bob, 'bob@example.com');
    expect(await (await app.send(bob, '/api/credentials')).json()).toEqual([]);
    expect((await app.send(bob, '/auth/credentials', { method: 'POST', headers: H, body: JSON.stringify({ savedId }) })).status).toBe(404);
    expect((await app.send(bob, `/api/credentials/${savedId}`, { method: 'DELETE', headers: H })).status).toBe(404);
    // Ciphertext copied onto another row (even the same user's) fails to decrypt.
    const enc = (await app.db.prepare('select secret_enc from sf_credentials where id = ?').bind(savedId).first<{ secret_enc: string }>())!.secret_enc;
    const other = (await (await app.request('/api/credentials', { method: 'POST', headers: H, body: JSON.stringify({ clientId: 'USERKEY99999999', clientSecret: 'another-secret' }) })).json()).id;
    await app.db.prepare('update sf_credentials set secret_enc = ? where id = ?').bind(enc, other).run();
    const moved = await app.request('/auth/credentials', { method: 'POST', headers: H, body: JSON.stringify({ savedId: other }) });
    expect(moved.status).toBe(400);
    expect((await moved.json()).error).toBe('saved_unreadable');
    // Deleting works for the owner.
    expect((await app.request(`/api/credentials/${savedId}`, { method: 'DELETE', headers: H })).status).toBe(200);
  });

  it('validates typed credentials and requires the CSRF header', async () => {
    const { fetchFn } = fakeSalesforce(() => undefined);
    const app = realApp(fetchFn);
    const post = (body: unknown, headers: Record<string, string> = H) => app.request('/auth/credentials', { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await post({ clientId: 'short' })).status).toBe(400);
    expect((await post({ clientId: 'USERKEY12345678', clientSecret: 'has space in it' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ savedId: 'not-a-uuid' })).status).toBe(400);
    expect((await post({ clientId: 'USERKEY12345678' }, { 'content-type': 'application/json' })).status).toBe(403);
  });

  it('rejects a mismatched state and a tampered transaction cookie', async () => {
    const { fetchFn, calls } = fakeSalesforce(() => tokenOk());
    const app = realApp(fetchFn);
    const jar = cookieJar();
    jar.absorb(await app.request('/auth/login'));
    const bad = await app.request('/auth/callback?code=C&state=WRONG', { headers: { cookie: jar.header() } });
    expect(bad.headers.get('location')).toMatch(/^\/\?error=/);
    const none = await app.request('/auth/callback?code=C&state=WRONG');
    expect(none.headers.get('location')).toMatch(/^\/\?error=/);
    expect(calls).toHaveLength(0);
  });

  it('rejects an instance_url outside the allowlist', async () => {
    const { fetchFn } = fakeSalesforce(() => tokenOk({ instance_url: 'https://169.254.169.254' }));
    const { cb, req } = await connect(fetchFn);
    expect(cb.headers.get('location')).toMatch(/^\/\?error=/);
    expect((await (await req('/api/session')).json()).connected).toBe(false);
  });

  it('surfaces callback errors from Salesforce', async () => {
    const { fetchFn } = fakeSalesforce(() => undefined);
    const res = await realApp(fetchFn).request('/auth/callback?error=access_denied&error_description=nope');
    expect(res.headers.get('location')).toBe('/?error=nope');
  });
});

describe('Connect API client', () => {
  const base = (c: Call) => (c.url.endsWith('/services/oauth2/token') ? tokenOk() : undefined);

  it('lists data spaces with the bearer token on the instance host', async () => {
    const { fetchFn, calls } = fakeSalesforce((c) =>
      c.url === `${API}/data-spaces?limit=4999`
        ? json({ dataSpaces: [{ name: 'default', label: 'default', status: 'Active' }], totalSize: 1 })
        : base(c),
    );
    const { req } = await connect(fetchFn);
    const res = await req('/api/dataspaces');
    expect(await res.json()).toEqual([{ name: 'default', label: 'default', status: 'Active' }]);
    expect(calls.at(-1)!.headers.authorization).toBe('Bearer AT1');
  });

  it('merges the three entity types and keeps partial failures as warnings', async () => {
    const { fetchFn } = fakeSalesforce((c) => {
      if (c.url.includes('entityType=DataModelObject')) {
        return json({
          metadata: [{
            name: 'ssot__Individual__dlm', displayName: 'Individual', category: 'Profile',
            fields: [{ name: 'ssot__Id__c', displayName: 'Individual Id', type: 'STRING', keyQualifier: 'KQ_Id__c' }],
            primaryKeys: [{ name: 'ssot__Id__c', indexOrder: '1' }],
            relationships: [{ fromEntity: 'a', toEntity: 'b', fromEntityAttribute: 'x', toEntityAttribute: 'y', cardinality: 'NTOONE' }],
          }],
        });
      }
      if (c.url.includes('entityType=CalculatedInsight')) {
        return json({ metadata: [{ name: 'Avg__cio', displayName: 'Avg', dimensions: [{ name: 'Id__c', type: 'STRING' }], measures: [{ name: 'M__c', type: 'NUMBER' }] }] });
      }
      if (c.url.includes('entityType=DataLakeObject')) return json([{ errorCode: 'FORBIDDEN', message: 'no access' }], 403);
      return base(c);
    });
    const { req } = await connect(fetchFn);
    const { objects, warnings } = await (await req('/api/metadata?dataspace=marketing')).json();
    expect(objects.map((o: { name: string; kind: string }) => `${o.kind}:${o.name}`)).toEqual(['dmo:ssot__Individual__dlm', 'ci:Avg__cio']);
    expect(objects[0].fields[0]).toMatchObject({ isPk: true, keyQualifier: 'KQ_Id__c' });
    expect(objects[1].fields.map((f: { role: string }) => f.role)).toEqual(['dimension', 'measure']);
    expect(warnings).toEqual(['DataLakeObject: no access']);
  });

  it('submits with sqlParameters, settings and query params; accepts bare-array rows', async () => {
    const { fetchFn, calls } = fakeSalesforce((c) =>
      c.url.startsWith(`${API}/query-sql?`)
        ? json({
            returnedRows: 2,
            metadata: [{ name: 'a', type: 'Varchar', nullable: true }],
            data: [['x'], { row: ['y'] }],
            status: { queryId: 'MTAu%2Fabc', completionStatus: 'Running', progress: 0.1, rowCount: 100, chunkCount: 1 },
          })
        : base(c),
    );
    const { req } = await connect(fetchFn);
    const res = await req('/api/query', {
      method: 'POST', headers: H,
      body: JSON.stringify({ sql: 'SELECT a FROM t WHERE b = :b', dataspace: 'marketing', paramDefs: [{ name: 'b', type: 'integer' }], params: { b: '7' } }),
    });
    const body = await res.json();
    expect(body).toMatchObject({ queryId: 'MTAu%2Fabc', done: false, rowCount: 100, rows: [['x'], ['y']] });
    const call = calls.find((c) => c.url.includes('/query-sql?'))!;
    const url = new URL(call.url);
    expect(url.searchParams.get('dataspace')).toBe('marketing');
    expect(url.searchParams.get('workloadName')).toBe('data360-workbench');
    expect(JSON.parse(call.body)).toEqual({
      sql: 'SELECT a FROM t WHERE b = :b',
      rowLimit: 1000,
      sqlParameters: [{ name: 'b', type: 'BigInt', value: '7' }],
      querySettings: { query_timeout: '300000ms' },
    });
  });

  it('passes the percent-encoded queryId through without double-encoding', async () => {
    const { fetchFn, calls } = fakeSalesforce((c) =>
      c.url.includes('/query-sql/') ? json({ data: [['x']] }) : base(c),
    );
    const { req } = await connect(fetchFn);
    await req(`/api/query/${encodeURIComponent('MTAu%2Fabc')}/rows?dataspace=default&offset=10&limit=50`);
    await req(`/api/query/${encodeURIComponent('MTAu%2Fabc')}?wait=99999`.replace('99999', '5000'));
    const rows = new URL(calls.find((c) => c.url.includes('/rows'))!.url);
    expect(rows.pathname).toBe('/services/data/v65.0/ssot/query-sql/MTAu%2Fabc/rows');
    expect(rows.searchParams.get('offset')).toBe('10');
    expect(rows.searchParams.get('rowLimit')).toBe('50');
    expect(rows.searchParams.get('dataspace')).toBe('default');
    const status = new URL(calls.find((c) => c.method === 'GET' && c.url.includes('/query-sql/') && !c.url.includes('/rows'))!.url);
    expect(status.pathname).toBe('/services/data/v65.0/ssot/query-sql/MTAu%2Fabc');
    expect(status.searchParams.get('waitTimeMs')).toBe('5000');
  });

  it('pages data streams and segments, and reports one side failing', async () => {
    const stream = (i: number) => ({ name: `S${i}`, label: `Stream ${i}`, status: 'ACTIVE', lastRunStatus: 'SUCCESS', totalRecords: i });
    const { fetchFn, calls } = fakeSalesforce((c) => {
      if (c.url.includes('/data-streams')) {
        const offset = Number(new URL(c.url).searchParams.get('offset'));
        const n = offset === 0 ? 200 : 50;
        return json({ dataStreams: Array.from({ length: n }, (_, i) => stream(offset + i)), totalSize: 250 });
      }
      if (c.url.includes('/segments')) return json([{ errorCode: 'FORBIDDEN', message: 'no segment access' }], 403);
      return base(c);
    });
    const { req } = await connect(fetchFn);
    const x = await (await req('/api/extras?dataspace=marketing')).json();
    expect(x.dataStreams).toMatchObject({ total: 250, truncated: false });
    expect(x.dataStreams.items).toHaveLength(250);
    expect(x.segments).toBeNull();
    expect(x.errors).toEqual(['Segments: no segment access']);
    const seg = calls.find((c) => c.url.includes('/segments'))!;
    expect(new URL(seg.url).searchParams.get('dataspace')).toBe('marketing');
    expect(new URL(seg.url).searchParams.get('batchSize')).toBe('200');
  });

  it('reads segment fields and keeps paging while pages are full', async () => {
    const seg = (i: number) => ({ apiName: `Seg_${i}`, displayName: `Segment ${i}`, segmentStatus: 'ACTIVE', publishStatus: 'PUBLISH_SUCCESS', lastSegmentMemberCount: i });
    const { fetchFn } = fakeSalesforce((c) => {
      if (c.url.includes('/data-streams')) return json({ dataStreams: [], totalSize: 0 });
      if (c.url.includes('/segments')) {
        const offset = Number(new URL(c.url).searchParams.get('offset'));
        return json({ segments: Array.from({ length: offset === 0 ? 200 : 7 }, (_, i) => seg(offset + i)) });
      }
      return base(c);
    });
    const { req } = await connect(fetchFn);
    const x = await (await req('/api/extras?dataspace=default')).json();
    expect(x.segments.total).toBe(207);
    expect(x.segments.items[3]).toMatchObject({ apiName: 'Seg_3', label: 'Segment 3', lastMemberCount: 3, status: 'ACTIVE' });
  });

  it('cancels with DELETE', async () => {
    const { fetchFn, calls } = fakeSalesforce((c) => (c.method === 'DELETE' ? new Response(null, { status: 200 }) : base(c)));
    const { req } = await connect(fetchFn);
    expect((await req('/api/query/abc123?dataspace=default', { method: 'DELETE', headers: H })).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE' });
    expect(calls.at(-1)!.url).toContain('/query-sql/abc123?');
  });

  it('refreshes once on 401, retries, and re-seals the cookie', async () => {
    let n = 0;
    const { fetchFn, calls } = fakeSalesforce((c) => {
      if (c.url.endsWith('/services/oauth2/token') && c.body.includes('refresh_token')) return json({ access_token: 'AT2', instance_url: INSTANCE });
      if (c.url.includes('/data-spaces')) return c.headers.authorization === 'Bearer AT2' ? json({ dataSpaces: [] }) : json([{ errorCode: 'INVALID_SESSION_ID' }], 401);
      n++;
      return base(c);
    });
    const { req, jar } = await connect(fetchFn);
    const before = jar.header();
    const res = await req('/api/dataspaces');
    jar.absorb(res);
    expect(res.status).toBe(200);
    expect(jar.header()).not.toBe(before); // new sealed session
    expect(calls.filter((c) => c.url.includes('/data-spaces'))).toHaveLength(2);
    expect(n).toBe(1);
    // the next request uses the refreshed token straight away
    await req('/api/dataspaces');
    expect(calls.filter((c) => c.url.includes('/data-spaces')).at(-1)!.headers.authorization).toBe('Bearer AT2');
    expect(calls.filter((c) => c.url.includes('/data-spaces'))).toHaveLength(3);
  });

  it('returns not_connected and clears the session when refresh fails', async () => {
    const { fetchFn } = fakeSalesforce((c) => {
      if (c.url.endsWith('/services/oauth2/token') && c.body.includes('refresh_token')) return json({ error: 'invalid_grant' }, 400);
      if (c.url.includes('/data-spaces')) return json([{ errorCode: 'INVALID_SESSION_ID' }], 401);
      return base(c);
    });
    const { req, jar } = await connect(fetchFn);
    const res = await req('/api/dataspaces');
    jar.absorb(res);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('not_connected');
    expect(jar.has('d360_session')).toBe(false);
  });

  it('maps Salesforce SQL errors to readable 400s', async () => {
    const { fetchFn } = fakeSalesforce((c) =>
      c.url.includes('/query-sql?') ? json([{ errorCode: '42P01', message: 'relation "nope" does not exist', details: 'line 1' }], 400) : base(c),
    );
    const { req } = await connect(fetchFn);
    const res = await req('/api/query', { method: 'POST', headers: H, body: JSON.stringify({ sql: 'SELECT * FROM nope' }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '42P01', message: 'relation "nope" does not exist — line 1' });
  });

  it('revokes the token on logout', async () => {
    const { fetchFn, calls } = fakeSalesforce((c) => (c.url.endsWith('/revoke') ? new Response('', { status: 200 }) : base(c)));
    const { req } = await connect(fetchFn);
    const res = await req('/auth/logout', { method: 'POST', headers: H });
    expect(res.status).toBe(200);
    expect(calls.at(-1)!.url).toBe('https://login.salesforce.com/services/oauth2/revoke');
    expect(new URLSearchParams(calls.at(-1)!.body).get('token')).toBe('RT1');
  });
});
