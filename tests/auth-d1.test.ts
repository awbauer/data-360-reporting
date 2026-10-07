import { describe, expect, it } from 'vitest';
import { purgeExpired } from '../server/app';
import { githubUserInfo, isAllowed } from '../server/auth';
import { loadConfig } from '../server/config';
import { fromNodeSqlite, migrateD1, migrateNodeSqlite, splitStatements } from '../server/db';
import { loadMigrations, openNodeDatabase } from '../server/node-db';
import { identityOf } from '../server/oauth';
import { cookieJar, H, mockApp, realApp, testConfig } from './helpers';

const json = (body: unknown) => ({ method: 'POST', headers: H, body: JSON.stringify(body) });

describe('app sign-in and allowlist', () => {
  it('reports the signed-out state and the configured providers publicly', async () => {
    const { app } = realApp(async () => new Response(null, { status: 500 }), { GITHUB_CLIENT_ID: 'gh', GITHUB_CLIENT_SECRET: 'ghs' });
    const body = await (await app.request('/api/session')).json();
    expect(body).toMatchObject({ user: null, providers: ['github'], connected: false });
    expect((await app.request('/api/history')).status).toBe(401);
  });

  it('matches only verified emails against the allowlist', () => {
    const c = testConfig({ AUTH_ALLOWED_EMAILS: 'Pat@Partner.io' });
    expect(isAllowed(c, { email: 'x@example.com', emailVerified: true })).toBe(true);
    expect(isAllowed(c, { email: 'x@example.com', emailVerified: false })).toBe(false);
    expect(isAllowed(c, { email: 'pat@partner.io', emailVerified: true })).toBe(true);
    expect(isAllowed(c, { email: 'x@evil-example.com', emailVerified: true })).toBe(false);
    expect(isAllowed(c, { email: 'x@sub.example.com', emailVerified: true })).toBe(false);
    expect(isAllowed(c, { email: 'admin@example.org', emailVerified: true })).toBe(true);
  });

  it('admits the configured Publicis domains and nothing that merely resembles them', () => {
    const c = testConfig({ AUTH_ALLOWED_DOMAINS: '@publicissapient.com, @publicisgroupe.net, @publicis.com', AUTH_ADMIN_EMAILS: '' });
    const ok = (email: string, emailVerified = true) => isAllowed(c, { email, emailVerified });
    expect(ok('Jane.Doe@PublicisSapient.com')).toBe(true);
    expect(ok('j@publicisgroupe.net')).toBe(true);
    expect(ok('j@publicis.com')).toBe(true);
    expect(ok('j@publicis.com', false)).toBe(false);
    expect(ok('j@uk.publicis.com')).toBe(false);
    expect(ok('j@publicis.com.evil.io')).toBe(false);
    expect(ok('j@notpublicis.com')).toBe(false);
    expect(ok('j@publicisgroupe.com')).toBe(false);
  });

  it('signs in with a verified allowlisted GitHub email even when the primary is personal', async () => {
    const c = testConfig({ AUTH_ALLOWED_DOMAINS: 'publicissapient.com', AUTH_ADMIN_EMAILS: '' });
    const gh = (emails: { email: string; verified: boolean; primary: boolean }[], email: string | null = null) =>
      (async (url: string | URL | Request) =>
        new Response(JSON.stringify(String(url).endsWith('/emails') ? emails : { id: 42, login: 'jdoe', name: 'J', email }))) as typeof fetch;
    const work = { email: 'jane@publicissapient.com', verified: true, primary: false };
    const home = { email: 'jane@gmail.com', verified: true, primary: true };
    expect((await githubUserInfo(c, 't', gh([home, work], 'jane@gmail.com')))!.user).toMatchObject({ email: 'jane@publicissapient.com', emailVerified: true });
    // An unverified work address doesn't count: fall back to the primary, which the gate then refuses.
    const r = await githubUserInfo(c, 't', gh([home, { ...work, verified: false }]));
    expect(r!.user).toMatchObject({ email: 'jane@gmail.com', emailVerified: true });
    expect(isAllowed(c, r!.user)).toBe(false);
    expect((await githubUserInfo(c, 't', gh([home, work])))!.data).toMatchObject({ id: 42 });
  });

  it('refuses to create a user outside the allowlist', async () => {
    const t = realApp(async () => new Response(null, { status: 500 }));
    const jar = cookieJar();
    const res = await t.send(jar, '/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'mallory@elsewhere.net', password: 'correct-horse-battery', name: 'M' }),
    });
    expect(res.ok).toBe(false);
    expect(await t.db.prepare('select count(*) as n from "user"').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('turns away a signed-in user whose email is not verified', async () => {
    const t = realApp(async () => new Response(null, { status: 500 }));
    const jar = cookieJar();
    await t.signIn(jar, 'carol@example.com');
    expect((await t.send(jar, '/api/history')).status).toBe(200);
    await t.db.prepare('update "user" set "emailVerified" = 0 where email = ?').bind('carol@example.com').run();
    await t.signIn(jar, 'carol@example.com'); // fresh session, fresh cookie cache
    const res = await t.send(jar, '/api/history');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not_allowed');
    const login = await t.send(jar, '/auth/login');
    expect(login.headers.get('location')).toMatch(/^\/\?error=.*not%20allowed/);
    expect((await (await t.send(jar, '/api/session')).json()).user).toMatchObject({ email: 'carol@example.com', allowed: false });
  });

  it("binds the Salesforce session cookie to the app user who connected", async () => {
    const t = mockApp();
    const a = cookieJar();
    await t.signIn(a, 'a@example.com');
    await t.send(a, '/auth/login');
    expect((await t.send(a, '/api/dataspaces')).status).toBe(200);
    const sf = a.header().split('; ').find((c) => c.startsWith('d360_session='))!;
    const b = cookieJar();
    await t.signIn(b, 'b@example.com');
    const res = await t.app.request('/api/dataspaces', { headers: { cookie: `${b.header()}; ${sf}` } });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('not_connected');
  });

  it('signs out of the app through Better Auth', async () => {
    const t = mockApp();
    const jar = cookieJar();
    await t.signIn(jar, 'a@example.com');
    const res = await t.send(jar, '/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    expect((await (await t.send(jar, '/api/session')).json()).user).toBeNull();
  });
});

describe('query audit log and history', () => {
  async function connected(email = 'alice@example.com') {
    const t = mockApp();
    const jar = cookieJar();
    await t.signIn(jar, email);
    await t.send(jar, '/auth/login');
    return { t, jar, req: (path: string, init: RequestInit = {}) => t.send(jar, path, init) };
  }

  it('records who ran what, against which org, and how it ended', async () => {
    const { t, req } = await connected();
    const ok = await (await req('/api/query', json({ sql: 'SELECT :n AS n', paramDefs: [{ name: 'n', type: 'integer' }], params: { n: '7' } }))).json();
    await req('/api/query', json({ sql: 'SELECT * FROM nope' }));
    await req('/api/query', json({ sql: 'SELECT 1 AS x', source: 'explorer' }));
    const rows = (await t.db.prepare('select * from query_log order by started_at').all<Record<string, unknown>>()).results;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      user_email: 'alice@example.com', instance_host: 'mock-org.my.salesforce.com', sf_org_id: '00D000000000001AAA',
      sf_user_id: '005000000000001AAA', dataspace: 'default', source: 'editor', status: 'done', row_count: 1,
      query_id: ok.queryId, params: '{"n":"7"}',
    });
    expect(rows[1]).toMatchObject({ status: 'failed', query_id: null });
    expect(String(rows[1]!.error)).toMatch(/no such table/);
    expect(rows[2]).toMatchObject({ source: 'explorer' });
  });

  it('closes long-running entries when polling sees them finish, and marks cancels', async () => {
    const { t, req } = await connected();
    const q = await (await req('/api/query', json({ sql: 'SELECT * FROM "ssot__EmailEngagement__dlm"' }))).json();
    expect(q.done).toBe(false);
    const id = encodeURIComponent(q.queryId);
    let st = await (await req(`/api/query/${id}`)).json();
    while (!st.done) st = await (await req(`/api/query/${id}`)).json();
    expect(await t.db.prepare('select status, row_count from query_log').first()).toEqual({ status: 'done', row_count: 5000 });

    const q2 = await (await req('/api/query', json({ sql: 'SELECT * FROM "ssot__EmailEngagement__dlm"' }))).json();
    await req(`/api/query/${encodeURIComponent(q2.queryId)}`, { method: 'DELETE', headers: H });
    expect(await t.db.prepare('select status from query_log where query_id = ?').bind(q2.queryId).first()).toEqual({ status: 'cancelled' });
  });

  it("shows each user only their own editor runs, and clearing hides them without deleting the audit", async () => {
    const { t, req } = await connected();
    await req('/api/query', json({ sql: 'SELECT 1 AS a' }));
    await req('/api/query', json({ sql: 'SELECT 2 AS b', source: 'overview' }));
    const hist = await (await req('/api/history')).json();
    expect(hist.map((h: { sql: string }) => h.sql)).toEqual(['SELECT 1 AS a']);
    expect(hist[0]).toMatchObject({ dataspace: 'default', instanceHost: 'mock-org.my.salesforce.com', status: 'done', rows: 1 });

    const bob = cookieJar();
    await t.signIn(bob, 'bob@example.com');
    expect(await (await t.send(bob, '/api/history')).json()).toEqual([]);

    await req('/api/history', { method: 'DELETE', headers: H });
    expect(await (await req('/api/history')).json()).toEqual([]);
    expect(await t.db.prepare('select count(*) as n from query_log').first()).toEqual({ n: 2 });
  });

  it('lets only admins read the audit, as JSON or CSV', async () => {
    const { t, req } = await connected();
    await req('/api/query', json({ sql: 'SELECT 1 AS a' }));
    expect((await req('/api/audit')).status).toBe(403);
    const admin = cookieJar();
    await t.signIn(admin, 'admin@example.org');
    const rows = await (await t.send(admin, '/api/audit?email=ALICE@example.com')).json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userEmail: 'alice@example.com', sql: 'SELECT 1 AS a' });
    expect(await (await t.send(admin, '/api/audit?email=nobody@example.com')).json()).toEqual([]);
    const csv = await (await t.send(admin, '/api/audit?format=csv')).text();
    const [header, line] = csv.trim().split('\n');
    expect(header).toMatch(/^started_at,user_email,instance_host,/);
    expect(line).toContain('alice@example.com,mock-org.my.salesforce.com,00D000000000001AAA');
  });

  it('purges entries past the retention window', async () => {
    const { t, req } = await connected();
    await req('/api/query', json({ sql: 'SELECT 1 AS a' }));
    expect(await purgeExpired(t.config, t.store, Date.now())).toBe(0);
    // One query and one sign-in event.
    expect(await purgeExpired(t.config, t.store, Date.now() + (t.config.auditRetentionDays + 1) * 86_400_000)).toBe(2);
  });
});

describe('per-user state', () => {
  it('stores tabs per user and rejects unknown keys and oversized payloads', async () => {
    const t = mockApp();
    const a = cookieJar();
    const b = cookieJar();
    await t.signIn(a, 'a@example.com');
    await t.signIn(b, 'b@example.com');
    expect(await (await t.send(a, '/api/state/tabs')).json()).toBeNull();
    const tabs = { tabs: [{ id: 't1', n: 1, sql: 'SELECT 1', paramDefs: [], values: {} }], active: 't1' };
    expect((await t.send(a, '/api/state/tabs', { method: 'PUT', headers: H, body: JSON.stringify({ value: tabs }) })).status).toBe(200);
    expect((await (await t.send(a, '/api/state/tabs')).json()).value).toEqual(tabs);
    expect(await (await t.send(b, '/api/state/tabs')).json()).toBeNull();
    expect((await t.send(a, '/api/state/secrets')).status).toBe(400);
    const big = JSON.stringify({ value: 'x'.repeat(600 * 1024) });
    expect((await t.send(a, '/api/state/tabs', { method: 'PUT', headers: H, body: big })).status).toBe(413);
  });
});

describe('configuration and plumbing', () => {
  it('requires a sign-in provider and an allowlist in production', () => {
    const base = { NODE_ENV: 'production', SESSION_KEY: 'k'.repeat(40) };
    expect(() => loadConfig(base)).toThrow(/GITHUB_CLIENT_ID/);
    const gh = { ...base, GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b' };
    expect(() => loadConfig(gh)).toThrow(/AUTH_ALLOWED_DOMAINS/);
    const c = loadConfig({ ...gh, AUTH_ALLOWED_DOMAINS: '@Example.com, partner.io' });
    expect(c.allowedDomains).toEqual(['example.com', 'partner.io']);
    expect(c.authSecret).not.toContain(base.SESSION_KEY);
    expect(c.authSecret).toHaveLength(64);
  });

  it('reads the org and user ids from the token identity URL', () => {
    expect(identityOf('https://login.salesforce.com/id/00D5g000004XYZaEAO/0055g00000ABCdeAAB')).toEqual({
      orgId: '00D5g000004XYZaEAO', userId: '0055g00000ABCdeAAB',
    });
    expect(identityOf('https://evil.example.com/whatever')).toEqual({});
    expect(identityOf(undefined)).toEqual({});
  });

  it('applies migrations once, recording them like wrangler does', () => {
    const { raw } = openNodeDatabase(':memory:');
    expect(migrateNodeSqlite(raw, loadMigrations())).toEqual([]);
    const names = (raw.prepare('select name from d1_migrations order by id').all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(['0001_auth.sql', '0002_app.sql', '0003_admin.sql', '0004_saved_login_host.sql', '0005_credit_plans.sql', '0006_query_estimates.sql']);
  });

  it('records a renamed migration without running it again', async () => {
    // A database migrated by the build that shipped 0005_query_estimates.sql (PR #19), which then
    // gets 0005_credit_plans.sql and the same estimate columns renumbered as 0006.
    const all = loadMigrations();
    const old = { name: '0005_query_estimates.sql', sql: all.find((m) => m.name === '0006_query_estimates.sql')!.sql };
    const before = [...all.filter((m) => m.name < '0005'), old];
    const names = (db: { prepare(q: string): { all(): unknown[] } }) => (db.prepare('select name from d1_migrations order by id').all() as { name: string }[]).map((r) => r.name);

    const { DatabaseSync } = (await import('node:module')).createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const raw = new DatabaseSync(':memory:');
    migrateNodeSqlite(raw, before);
    expect(migrateNodeSqlite(raw, all)).toEqual(['0005_credit_plans.sql']);
    expect(names(raw)).toContain('0006_query_estimates.sql');
    expect(migrateNodeSqlite(raw, all)).toEqual([]);

    const viaD1 = new DatabaseSync(':memory:');
    const d1 = fromNodeSqlite(viaD1 as never);
    await migrateD1(d1, before);
    expect(await migrateD1(d1, all)).toEqual(['0005_credit_plans.sql']);
    expect(names(viaD1 as never)).toContain('0006_query_estimates.sql');
    expect(await migrateD1(d1, all)).toEqual([]);
    const cols = (viaD1.prepare('pragma table_info(query_log)').all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => c === 'est_rows')).toHaveLength(1);
  });

  it('bundles every migration into the Worker', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../worker/migrations.ts', import.meta.url), 'utf8');
    for (const m of loadMigrations()) expect(src).toContain(`{ name: '${m.name}', sql:`);
  });

  it('migrates a D1-shaped database the same way, and tolerates a concurrent migrator', async () => {
    const { DatabaseSync } = (await import('node:module')).createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const viaD1 = new DatabaseSync(':memory:');
    const d1 = fromNodeSqlite(viaD1 as never);
    expect(await migrateD1(d1, loadMigrations())).toEqual(['0001_auth.sql', '0002_app.sql', '0003_admin.sql', '0004_saved_login_host.sql', '0005_credit_plans.sql', '0006_query_estimates.sql']);
    expect(await migrateD1(d1, loadMigrations())).toEqual([]);
    const schema = (db: InstanceType<typeof DatabaseSync>) =>
      (db.prepare("select name, type from sqlite_master where name not like 'sqlite_%' order by name").all() as unknown[]);
    const { raw } = openNodeDatabase(':memory:');
    expect(schema(viaD1)).toEqual(schema(raw as never));
    // Another isolate recorded 0002 between our read and our batch: the batch fails, the re-check passes.
    const racing = new DatabaseSync(':memory:');
    const racingD1 = fromNodeSqlite(racing as never);
    const [first, second] = loadMigrations();
    await migrateD1(racingD1, [first!]);
    const realBatch = racingD1.batch!.bind(racingD1);
    racingD1.batch = async (sts) => {
      for (const q of splitStatements(second!.sql)) racing.exec(q);
      racing.prepare('insert into d1_migrations (name) values (?)').run(second!.name);
      return realBatch(sts);
    };
    expect(await migrateD1(racingD1, [first!, second!])).toEqual([]);
    // A genuinely broken migration still fails loudly.
    await expect(migrateD1(d1, [{ name: '9999_bad.sql', sql: 'create table oops (' }])).rejects.toThrow(/9999_bad/);
  });
});
