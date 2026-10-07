import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { z, ZodError } from 'zod';
import { isAdmin, isAllowed, withSignInEvents, type AppUser, type Auth } from './auth';
import type { Config } from './config';
import { pkceChallenge, randomToken, seal, unseal } from './crypto';
import { createConnectClient, type SessionHolder } from './data360/client';
import { UpstreamError, type Data360Client } from './data360/types';
import { assertAllowedOrigin, HostNotAllowedError } from './hosts';
import { authorizeUrl, exchangeCode, OAuthError, preflightAuthorize, revokeToken, type FetchLike, type OAuthTx, type Session } from './oauth';
import { maskClientId, type RunRecord, type Store } from './store';
import type { Block } from './admin-store';
import { registerAdminRoutes } from './admin-routes';
import { registerPlanRoutes } from './plan-routes';
import { toCsvLine } from '../shared/csv';
import { toSqlParameters } from '../shared/sql';
import type { ParamDef, QueryResponse } from '../shared/types';

export interface AppDeps {
  config: Config;
  fetch?: FetchLike;
  /** Used for sessions created in mock mode. */
  mockClient?: Data360Client;
  auth: Auth;
  store: Store;
}

type Env = { Variables: { user?: AppUser; block?: Block | null; session?: Session; holder?: SessionHolder; client?: Data360Client } };

const SESSION_COOKIE = 'd360_session';
const TX_COOKIE = 'd360_oauth';
const CRED_COOKIE = 'd360_cred';
// Each sealed value is bound to its purpose and to the signed-in user, so one can't be replayed
// as another, and a Salesforce session left in a shared browser is useless to the next user.
const P = {
  session: (u: AppUser) => `session:${u.id}`,
  tx: (u: AppUser) => `oauth-tx:${u.id}`,
  cred: (u: AppUser) => `cred:${u.id}`,
  saved: (u: AppUser, id: string) => `sf-cred:${u.id}:${id}`,
};
const SESSION_TTL = 60 * 60 * 24 * 7;
const TX_TTL = 600;
const SAVED_TTL = 60 * 60 * 24 * 365 * 10;
const MAX_SAVED_CREDENTIALS = 25;
const MAX_STATE_BYTES = 512 * 1024;
const STATE_KEYS = new Set(['tabs']);
const DATASPACE_RE = /^[A-Za-z0-9_]{1,80}$/;
const OBJECT_NAME_RE = /^[A-Za-z0-9_]{1,255}$/;
const QUERY_ID_RE = /^[A-Za-z0-9%._~=+-]{1,512}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{10,256}$/;
const CLIENT_SECRET_RE = /^\S{8,256}$/;

interface Credentials {
  clientId: string;
  clientSecret?: string;
  /** Where to sign in; set for saved connections, which then ignore the page's org-type choice. */
  loginHost?: string;
}

const paramDef = z.object({
  name: z.string(),
  type: z.enum(['string', 'integer', 'number', 'boolean', 'date', 'timestamp']),
  label: z.string().optional(),
  default: z.string().optional(),
});
const loginChoice = {
  env: z.enum(['production', 'sandbox', 'custom']).optional(),
  domain: z.string().trim().max(255).optional(),
};
const credentialFields = {
  clientId: z.string().trim().regex(CLIENT_ID_RE, 'That does not look like a consumer key'),
  clientSecret: z.string().regex(CLIENT_SECRET_RE, 'That does not look like a consumer secret').optional(),
  label: z.string().trim().max(80).optional(),
  ...loginChoice,
};
const credentialsBody = z.union([
  z.object({ savedId: z.string().uuid(), ...loginChoice }),
  z.object({ ...credentialFields, remember: z.boolean().default(false) }),
]);
const queryBody = z.object({
  sql: z.string().min(1).max(200_000),
  dataspace: z.string().regex(DATASPACE_RE).default('default'),
  paramDefs: z.array(paramDef).max(100).default([]),
  params: z.record(z.string()).default({}),
  source: z.enum(['editor', 'explorer', 'overview', 'library']).default('editor'),
  /** The browser's estimate of rows read, from cached row counts. Recorded, never trusted for anything. */
  estRows: z.number().int().min(0).max(1e13).nullable().optional(),
  estComplete: z.boolean().optional(),
});

export function createApp({ config, fetch: fetchFn = fetch, mockClient, auth, store }: AppDeps): Hono<Env> {
  /** Production, Sandbox or a My Domain (checked against the host allowlist) to a login origin. */
  const loginHostFor = (env: string | undefined, domain: string | undefined): string =>
    env === 'sandbox'
      ? 'https://test.salesforce.com'
      : env === 'custom'
        ? assertAllowedOrigin(domain ?? '', config.allowedHostSuffixes)
        : config.loginUrl;

  const app = new Hono<Env>();
  const cookieOpts = { httpOnly: true, secure: config.secureCookies, sameSite: 'Lax' as const, path: '/' };

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // CodeMirror injects <style> elements at runtime.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        formAction: ["'self'"],
      },
      referrerPolicy: 'same-origin',
    }),
  );

  // App sign-in (Better Auth). It checks the Origin of its own POSTs against trustedOrigins.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => withSignInEvents(store, () => auth.handler(c.req.raw)));

  // CSRF: state-changing requests must carry a custom header, which cross-site forms can't set.
  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-d360') !== '1') {
      return c.json({ error: 'forbidden', message: 'Missing X-D360 header' }, 403);
    }
    await next();
  });

  // Who is signed in to the app, and their Salesforce session if they have connected one.
  app.use('*', async (c, next) => {
    const { headers, response } = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true });
    const user = response?.user;
    // The session must still exist (an admin may have revoked it, which Better Auth's cookie cache
    // wouldn't notice for minutes), and its user must not be blocked. One read covers both.
    const state = user ? await store.sessionState(response.session.token, user.id) : null;
    if (user && state?.live) {
      c.set('block', state.block);
      const u: AppUser = { id: user.id, email: user.email.toLowerCase(), name: user.name, emailVerified: user.emailVerified, image: user.image ?? null };
      c.set('user', u);
      const token = getCookie(c, SESSION_COOKIE);
      if (token) {
        const s = await unseal<Session>(config.sessionKey, token, P.session(u));
        if (s) c.set('session', s);
      }
    }
    await next();
    // Pass on any session-cookie refresh Better Auth made while reading the session.
    for (const v of headers.getSetCookie()) c.res.headers.append('set-cookie', v);
  });

  const startSession = async (c: Context<Env>, user: AppUser, session: Session) =>
    setCookie(c, SESSION_COOKIE, await seal(config.sessionKey, session, SESSION_TTL, P.session(user)), { ...cookieOpts, maxAge: SESSION_TTL });

  // ------------------------------------------------------------------ session (public)

  app.get('/api/session', (c) => {
    const s = c.get('session');
    const u = c.get('user');
    return c.json({
      user: u
        ? {
            email: u.email, name: u.name, image: u.image ?? null, allowed: isAllowed(config, u), admin: isAdmin(config, u),
            blocked: Boolean(c.get('block')),
          }
        : null,
      providers: [...(config.providers.github ? ['github'] : []), ...(config.providers.google ? ['google'] : [])],
      connected: Boolean(s),
      instanceHost: s ? new URL(s.instanceUrl).host : null,
      mock: config.mock,
      defaultClientConfigured: Boolean(config.clientId),
    });
  });

  // Everything below needs a signed-in user on the allowlist.
  const gate = (redirect: boolean) => async (c: Context<Env>, next: () => Promise<void>) => {
    const u = c.get('user');
    if (!u || !isAllowed(config, u) || c.get('block')) {
      const [code, message] = !u
        ? (['unauthenticated', 'Sign in first.'] as const)
        : c.get('block')
          ? (['blocked', 'Your access to this workbench has been suspended. Contact an administrator.'] as const)
          : (['not_allowed', `${u.email} is not allowed to use this app.`] as const);
      return redirect ? c.redirect(`/?error=${encodeURIComponent(message)}`) : c.json({ error: code, message }, u ? 403 : 401);
    }
    await next();
  };
  app.use('/auth/*', async (c, next) => gate(c.req.method === 'GET')(c, next));
  app.use('/api/*', gate(false));

  // ------------------------------------------------------------------ auth

  app.get('/auth/login', async (c) => {
    const fail = (message: string) => c.redirect(`/?error=${encodeURIComponent(message)}`);
    try {
      const user = c.get('user')!;
      if (config.mock) {
        if (!mockClient) return fail('Mock client is not configured');
        await startSession(c, user, {
          accessToken: 'mock',
          instanceUrl: 'https://mock-org.my.salesforce.com',
          loginHost: 'https://login.salesforce.com',
          clientId: 'mock',
          orgId: '00D000000000001AAA',
          userId: '005000000000001AAA',
          mock: true,
        });
        return c.redirect('/');
      }
      // Credentials the user entered or picked (set just before by POST /auth/credentials) override
      // the app's own, and a saved connection's login host overrides the org-type choice.
      const credToken = getCookie(c, CRED_COOKIE);
      deleteCookie(c, CRED_COOKIE, { path: '/' });
      const cred = credToken ? await unseal<Credentials>(config.sessionKey, credToken, P.cred(user)) : null;
      const loginHost = cred?.loginHost ?? loginHostFor(c.req.query('env'), c.req.query('domain'));
      const clientId = cred?.clientId ?? config.clientId;
      if (!clientId) return fail('No consumer key configured. Enter one under Advanced.');
      const verifier = randomToken(48);
      const tx: OAuthTx = {
        verifier,
        state: randomToken(24),
        loginHost,
        clientId,
        ...(cred?.clientSecret ? { clientSecret: cred.clientSecret } : {}),
      };
      const url = authorizeUrl(config, tx, await pkceChallenge(verifier));
      if (config.authorizePreflight) {
        const rejected = await preflightAuthorize(config, fetchFn, url, loginHost);
        if (rejected) return fail(rejected);
      }
      setCookie(c, TX_COOKIE, await seal(config.sessionKey, tx, TX_TTL, P.tx(user)), { ...cookieOpts, maxAge: TX_TTL });
      return c.redirect(url);
    } catch (e) {
      return fail(e instanceof HostNotAllowedError ? e.message : 'Could not start login');
    }
  });

  /**
   * Accepts the user's own consumer key/secret, typed or picked from their saved list, and parks
   * them in a short-lived sealed cookie for the login redirect that follows. The secret is never
   * in a URL. With `remember`, it is also saved to the database, encrypted with SESSION_KEY.
   */
  app.post('/auth/credentials', async (c) => {
    const user = c.get('user')!;
    const body = credentialsBody.parse(await c.req.json());
    let cred: Credentials;
    let savedId: string | undefined;
    if ('savedId' in body) {
      const row = await store.getCredential(user.id, body.savedId);
      if (!row) return c.json({ error: 'not_found', message: 'Those saved credentials no longer exist.' }, 404);
      const secret = row.secretEnc ? await unseal<string>(config.sessionKey, row.secretEnc, P.saved(user, body.savedId)) : null;
      if (row.secretEnc && !secret) {
        return c.json({ error: 'saved_unreadable', message: 'The saved secret can no longer be decrypted (SESSION_KEY changed?). Delete it and save it again.' }, 400);
      }
      // Connections saved before hosts were stored take the page's choice once, and keep it.
      let loginHost = row.loginHost;
      if (!loginHost) {
        loginHost = loginHostFor(body.env, body.domain);
        await store.setCredentialLoginHost(user.id, body.savedId, loginHost);
      }
      cred = { clientId: row.clientId, ...(secret ? { clientSecret: secret } : {}), loginHost };
      savedId = body.savedId;
      await store.touchCredential(user.id, savedId);
    } else {
      const loginHost = body.env ? loginHostFor(body.env, body.domain) : undefined;
      cred = { clientId: body.clientId, ...(body.clientSecret ? { clientSecret: body.clientSecret } : {}), ...(loginHost ? { loginHost } : {}) };
      if (body.remember) savedId = await saveCredential(user, { ...body, loginHost: loginHost ?? config.loginUrl });
    }
    setCookie(c, CRED_COOKIE, await seal(config.sessionKey, cred, TX_TTL, P.cred(user)), { ...cookieOpts, maxAge: TX_TTL });
    return c.json({
      clientIdHint: maskClientId(cred.clientId),
      hasSecret: Boolean(cred.clientSecret),
      ...(cred.loginHost ? { loginHost: cred.loginHost } : {}),
      ...(savedId ? { savedId } : {}),
    });
  });

  const saveCredential = async (user: AppUser, b: { clientId: string; clientSecret?: string; label?: string; loginHost: string }): Promise<string> => {
    if ((await store.listCredentials(user.id)).length >= MAX_SAVED_CREDENTIALS) {
      throw new RangeError(`You can save at most ${MAX_SAVED_CREDENTIALS} credentials. Delete one first.`);
    }
    const id = crypto.randomUUID();
    const secretEnc = b.clientSecret ? await seal(config.sessionKey, b.clientSecret, SAVED_TTL, P.saved(user, id)) : null;
    await store.saveCredential(user.id, { id, label: b.label || new URL(b.loginHost).host, clientId: b.clientId, secretEnc, loginHost: b.loginHost });
    return id;
  };

  app.get('/auth/callback', async (c) => {
    const fail = (message: string) => c.redirect(`/?error=${encodeURIComponent(message)}`);
    const token = getCookie(c, TX_COOKIE);
    deleteCookie(c, TX_COOKIE, { path: '/' });
    const user = c.get('user')!;
    const tx = token ? await unseal<OAuthTx>(config.sessionKey, token, P.tx(user)) : null;
    const { code, state, error, error_description: description } = c.req.query();
    if (error) return fail(description || error);
    if (!tx || !code || !state || state !== tx.state) return fail('Login expired or was tampered with. Try again.');
    try {
      await startSession(c, user, await exchangeCode(config, fetchFn, tx, code));
      return c.redirect('/');
    } catch (e) {
      return fail(e instanceof OAuthError || e instanceof HostNotAllowedError ? e.message : 'Login failed');
    }
  });

  app.post('/auth/logout', async (c) => {
    const s = c.get('session');
    if (s && !s.mock) await revokeToken(fetchFn, s);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------------- api

  // Routes that need the app user but not a Salesforce connection.

  app.get('/api/history', async (c) => {
    const limit = intOf(c.req.query('limit'), 50, 1, 200);
    return c.json((await store.history(c.get('user')!.id, limit)).map(toHistoryItem));
  });

  app.delete('/api/history', async (c) => {
    await store.hideHistory(c.get('user')!.id);
    return c.json({ ok: true });
  });

  registerAdminRoutes(app, { config, store });
  registerPlanRoutes(app, { store });

  app.get('/api/audit', async (c) => {
    if (!isAdmin(config, c.get('user')!)) return c.json({ error: 'forbidden', message: 'Admins only' }, 403);
    const q = c.req.query();
    const rows = await store.audit({
      ...(q.email ? { email: q.email } : {}),
      ...(q.host ? { host: q.host } : {}),
      ...(q.before ? { before: intOf(q.before, 0, 0, Number.MAX_SAFE_INTEGER) } : {}),
      limit: intOf(q.limit, 200, 1, q.format === 'csv' ? 50_000 : 500),
    });
    if (q.format !== 'csv') return c.json(rows);
    const header = ['started_at', 'user_email', 'instance_host', 'sf_org_id', 'sf_user_id', 'dataspace', 'source', 'status', 'row_count', 'duration_ms', 'est_rows_read', 'est_complete', 'error', 'sql', 'params'];
    const lines = rows.map((r) => toCsvLine([
      new Date(r.startedAt).toISOString(), r.userEmail, r.instanceHost, r.sfOrgId, r.sfUserId, r.dataspace, r.source, r.status,
      r.rowCount, r.finishedAt ? r.finishedAt - r.startedAt : null, r.estRows, r.estComplete === null ? null : r.estComplete ? 'yes' : 'no', r.error, r.sql, JSON.stringify(r.params),
    ]));
    return new Response([toCsvLine(header), ...lines].join('\n') + '\n', {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="query-audit.csv"', 'cache-control': 'no-store' },
    });
  });

  const stateKey = (c: Context<Env>) => {
    const key = c.req.param('key') ?? '';
    if (!STATE_KEYS.has(key)) throw new RangeError('Unknown state key');
    return key;
  };

  app.get('/api/state/:key', async (c) => c.json(await store.getState(c.get('user')!.id, stateKey(c))));

  app.put('/api/state/:key', async (c) => {
    const key = stateKey(c);
    const text = await c.req.text();
    if (text.length > MAX_STATE_BYTES) return c.json({ error: 'too_large', message: 'Too much to save on the server' }, 413);
    const { value } = z.object({ value: z.unknown() }).parse(JSON.parse(text));
    await store.putState(c.get('user')!.id, key, JSON.stringify(value));
    return c.json({ ok: true });
  });

  app.get('/api/credentials', async (c) => c.json(await store.listCredentials(c.get('user')!.id)));

  app.post('/api/credentials', async (c) => {
    const body = z.object(credentialFields).parse(await c.req.json());
    return c.json({ id: await saveCredential(c.get('user')!, { ...body, loginHost: loginHostFor(body.env, body.domain) }) });
  });

  app.delete('/api/credentials/:id', async (c) => {
    const ok = await store.deleteCredential(c.get('user')!.id, c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found', message: 'Not found' }, 404);
  });

  app.use('/api/*', async (c, next) => {
    const session = c.get('session');
    if (!session) return c.json({ error: 'not_connected', message: 'Not connected to Salesforce' }, 401);
    if (session.mock) {
      if (!mockClient) return c.json({ error: 'server_error', message: 'Mock client is not configured' }, 500);
      c.set('client', mockClient);
      return next();
    }
    const holder: SessionHolder = { current: session, refreshed: false };
    c.set('client', createConnectClient(config, fetchFn, holder));
    await next();
    if (holder.refreshed) await startSession(c, c.get('user')!, holder.current);
  });

  const dataspaceOf = (c: Context<Env>): string => {
    const ds = c.req.query('dataspace') ?? 'default';
    if (!DATASPACE_RE.test(ds)) throw new RangeError('Invalid data space name');
    return ds;
  };
  const idOf = (c: Context<Env>): string => {
    const id = c.req.param('id') ?? '';
    if (!QUERY_ID_RE.test(id)) throw new RangeError('Invalid query id');
    return id;
  };

  app.get('/api/dataspaces', async (c) => c.json(await c.get('client')!.listDataSpaces()));

  app.get('/api/metadata', async (c) => c.json(await c.get('client')!.getMetadata(dataspaceOf(c))));

  app.get('/api/extras', async (c) => c.json(await c.get('client')!.getExtras(dataspaceOf(c))));

  const objectNameOf = (v: string | undefined): string => {
    if (!v || !OBJECT_NAME_RE.test(v)) throw new RangeError('Invalid object name');
    return v;
  };

  // Lineage: the DLOs that feed one DMO (optionally narrowed to one DLO). The upstream API has no
  // lookup by DLO alone, so the browser walks the DMOs for that direction. Metadata only, no query credits.
  app.get('/api/mappings', async (c) => {
    const dlo = c.req.query('dlo');
    return c.json(await c.get('client')!.getMappings(dataspaceOf(c), objectNameOf(c.req.query('dmo')), dlo ? objectNameOf(dlo) : undefined));
  });

  app.get('/api/identity', async (c) => {
    const ds = dataspaceOf(c);
    const all = await c.get('client')!.getIdentityResolutions();
    return c.json(all.filter((r) => !r.dataSpace || r.dataSpace === ds));
  });

  app.get('/api/insights/:name', async (c) => c.json(await c.get('client')!.getCalculatedInsight(objectNameOf(c.req.param('name')))));

  app.post('/api/query', async (c) => {
    const body = queryBody.parse(await c.req.json());
    const params = toSqlParameters(body.sql, body.paramDefs as ParamDef[], body.params);
    const user = c.get('user')!;
    const session = c.get('session')!;
    const started = Date.now();
    // Recorded before anything reaches Salesforce: if the audit write fails, the query doesn't run.
    const run: RunRecord = {
      id: crypto.randomUUID(),
      userId: user.id,
      userEmail: user.email,
      instanceHost: new URL(session.instanceUrl).host.toLowerCase(),
      sfOrgId: session.orgId ?? null,
      sfUserId: session.userId ?? null,
      dataspace: body.dataspace,
      source: body.source,
      sql: body.sql,
      paramDefs: body.paramDefs as ParamDef[],
      params: body.params,
      queryId: null,
      status: 'running',
      rowCount: null,
      error: null,
      startedAt: started,
      finishedAt: null,
      estRows: body.estRows ?? null,
      estComplete: body.estRows === undefined || body.estRows === null ? null : (body.estComplete ?? false),
    };
    await store.logRun(run);
    let res;
    try {
      res = await c.get('client')!.submitQuery({ sql: body.sql, dataspace: body.dataspace, params, rowLimit: config.firstChunkRows });
    } catch (e) {
      await store.updateRun(run.id, { status: 'failed', error: (e as Error).message.slice(0, 2000), finishedAt: Date.now() });
      throw e;
    }
    await store.updateRun(run.id, {
      queryId: res.queryId,
      status: res.done ? 'done' : 'running',
      rowCount: res.done ? res.rowCount : null,
      finishedAt: res.done ? Date.now() : null,
    });
    return c.json({ ...res, elapsedMs: Date.now() - started } satisfies QueryResponse);
  });

  app.get('/api/query/:id', async (c) => {
    const wait = intOf(c.req.query('wait'), 0, 0, 10_000);
    const id = idOf(c);
    const status = await c.get('client')!.getStatus(id, dataspaceOf(c), wait);
    if (status.done) await store.finishRun(c.get('user')!.id, id, 'done', status.rowCount);
    return c.json(status);
  });

  app.get('/api/query/:id/rows', async (c) => {
    const offset = intOf(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intOf(c.req.query('limit'), 1000, 1, 5000);
    return c.json(await c.get('client')!.getRows(idOf(c), dataspaceOf(c), offset, limit));
  });

  app.delete('/api/query/:id', async (c) => {
    const id = idOf(c);
    await c.get('client')!.cancel(id, dataspaceOf(c));
    await store.finishRun(c.get('user')!.id, id, 'cancelled', null);
    return c.json({ ok: true });
  });

  app.get('/api/query/:id/export.csv', async (c) => {
    const client = c.get('client')!;
    const id = idOf(c);
    const dataspace = dataspaceOf(c);
    const PAGE = 2000;

    // Wait (bounded) for the query to finish before paging.
    let status = await client.getStatus(id, dataspace, 0);
    for (let i = 0; !status.done && i < 12; i++) status = await client.getStatus(id, dataspace, 5000);
    if (!status.done) return c.json({ error: 'still_running', message: 'Query is still running' }, 409);

    const total = Math.min(status.rowCount, config.maxExportRows);
    const first = await client.getRows(id, dataspace, 0, Math.min(PAGE, Math.max(total, 1)));
    let cols: string[] | undefined;
    try {
      const raw = c.req.query('cols');
      const parsed = raw ? z.array(z.string()).max(2000).parse(JSON.parse(raw)) : undefined;
      cols = parsed ?? first.columns?.map((x) => x.name);
    } catch {
      throw new RangeError('Invalid cols parameter');
    }
    const header = cols ?? (first.rows[0] ?? []).map((_, i) => `column${i + 1}`);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`${toCsvLine(header)}\n`));
          let sent = 0;
          let page = first.rows;
          while (page.length > 0 && sent < total) {
            const slice = page.slice(0, total - sent);
            controller.enqueue(encoder.encode(slice.map((r) => `${toCsvLine(r)}\n`).join('')));
            sent += slice.length;
            if (sent >= total || page.length < PAGE) break;
            page = (await client.getRows(id, dataspace, sent, Math.min(PAGE, total - sent))).rows;
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="query-results.csv"',
        'cache-control': 'no-store',
        ...(status.rowCount > config.maxExportRows ? { 'x-export-truncated': 'true' } : {}),
      },
    });
  });

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not_found', message: 'Not found' }, 404) : c.text('Not found', 404)));

  app.onError((err, c) => {
    if (err instanceof UpstreamError) {
      if (err.status === 401) {
        deleteCookie(c, SESSION_COOKIE, { path: '/' });
        return c.json({ error: 'not_connected', message: 'Your Salesforce session expired. Connect again.' }, 401);
      }
      const status = [400, 403, 404, 408].includes(err.status) ? (err.status as 400 | 403 | 404 | 408) : 502;
      return c.json({ error: err.code ?? 'upstream_error', message: err.message }, status);
    }
    if (err instanceof ZodError) {
      return c.json({ error: 'bad_request', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
    }
    if (err instanceof HostNotAllowedError) return c.json({ error: 'bad_request', message: err.message }, 400);
    if (err instanceof RangeError || err instanceof SyntaxError || (err instanceof Error && /^(Parameter|Missing value)/.test(err.message))) {
      return c.json({ error: 'bad_request', message: err.message }, 400);
    }
    console.error(err);
    return c.json({ error: 'server_error', message: 'Unexpected server error' }, 500);
  });

  return app;
}

function intOf(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = v === undefined || v === '' ? fallback : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new RangeError(`Expected an integer between ${min} and ${max}`);
  return n;
}

export interface HistoryItem {
  id: string;
  at: string;
  sql: string;
  dataspace: string;
  instanceHost: string;
  paramDefs: ParamDef[];
  params: Record<string, string>;
  status: RunRecord['status'];
  rows: number | null;
  elapsedMs: number | null;
  error: string | null;
  estRows: number | null;
  estComplete: boolean | null;
}

function toHistoryItem(r: RunRecord): HistoryItem {
  return {
    id: r.id,
    at: new Date(r.startedAt).toISOString(),
    sql: r.sql,
    dataspace: r.dataspace,
    instanceHost: r.instanceHost,
    paramDefs: r.paramDefs,
    params: r.params,
    status: r.status,
    rows: r.rowCount,
    elapsedMs: r.finishedAt ? r.finishedAt - r.startedAt : null,
    error: r.error,
    estRows: r.estRows,
    estComplete: r.estComplete,
  };
}

/** Deletes audit entries past the retention window. Run daily (Worker cron / Node timer). */
export async function purgeExpired(config: Config, store: Store, now = Date.now()): Promise<number> {
  const cutoff = now - config.auditRetentionDays * 86_400_000;
  return (await store.purgeRuns(cutoff)) + (await store.purgeLogins(cutoff));
}

