import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { z, ZodError } from 'zod';
import type { Config } from './config';
import { pkceChallenge, randomToken, seal, unseal } from './crypto';
import { createConnectClient, type SessionHolder } from './data360/client';
import { UpstreamError, type Data360Client } from './data360/types';
import { assertAllowedOrigin, HostNotAllowedError } from './hosts';
import { authorizeUrl, exchangeCode, OAuthError, revokeToken, type FetchLike, type OAuthTx, type Session } from './oauth';
import { toSqlParameters } from '../shared/sql';
import type { CellValue, ParamDef, QueryResponse } from '../shared/types';

export interface AppDeps {
  config: Config;
  fetch?: FetchLike;
  /** Used for sessions created in mock mode. */
  mockClient?: Data360Client;
}

type Env = { Variables: { session?: Session; holder?: SessionHolder; client?: Data360Client } };

const SESSION_COOKIE = 'd360_session';
const TX_COOKIE = 'd360_oauth';
const SESSION_TTL = 60 * 60 * 24 * 7;
const TX_TTL = 600;
const DATASPACE_RE = /^[A-Za-z0-9_]{1,80}$/;
const QUERY_ID_RE = /^[A-Za-z0-9%._~=+-]{1,512}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{10,256}$/;

const paramDef = z.object({
  name: z.string(),
  type: z.enum(['string', 'integer', 'number', 'boolean', 'date', 'timestamp']),
  label: z.string().optional(),
  default: z.string().optional(),
});
const queryBody = z.object({
  sql: z.string().min(1).max(200_000),
  dataspace: z.string().regex(DATASPACE_RE).default('default'),
  paramDefs: z.array(paramDef).max(100).default([]),
  params: z.record(z.string()).default({}),
});

export function createApp({ config, fetch: fetchFn = fetch, mockClient }: AppDeps): Hono<Env> {
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

  // CSRF: state-changing requests must carry a custom header, which cross-site forms can't set.
  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-d360') !== '1') {
      return c.json({ error: 'forbidden', message: 'Missing X-D360 header' }, 403);
    }
    await next();
  });

  app.use('*', async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const s = await unseal<Session>(config.sessionKey, token);
      if (s) c.set('session', s);
    }
    await next();
  });

  const startSession = async (c: Context<Env>, session: Session) =>
    setCookie(c, SESSION_COOKIE, await seal(config.sessionKey, session, SESSION_TTL), { ...cookieOpts, maxAge: SESSION_TTL });

  // ------------------------------------------------------------------ auth

  app.get('/auth/login', async (c) => {
    const fail = (message: string) => c.redirect(`/?error=${encodeURIComponent(message)}`);
    try {
      if (config.mock) {
        if (!mockClient) return fail('Mock client is not configured');
        await startSession(c, {
          accessToken: 'mock',
          instanceUrl: 'https://mock-org.my.salesforce.com',
          loginHost: 'https://login.salesforce.com',
          clientId: 'mock',
          mock: true,
        });
        return c.redirect('/');
      }
      const env = c.req.query('env') ?? 'production';
      const loginHost =
        env === 'sandbox'
          ? 'https://test.salesforce.com'
          : env === 'custom'
            ? assertAllowedOrigin(c.req.query('domain') ?? '', config.allowedHostSuffixes)
            : config.loginUrl;
      const override = c.req.query('clientId')?.trim();
      if (override && !CLIENT_ID_RE.test(override)) return fail('That does not look like a consumer key');
      const clientId = override || config.clientId;
      if (!clientId) return fail('No consumer key configured. Enter one under Advanced.');
      const verifier = randomToken(48);
      const tx: OAuthTx = { verifier, state: randomToken(24), loginHost, clientId };
      setCookie(c, TX_COOKIE, await seal(config.sessionKey, tx, TX_TTL), { ...cookieOpts, maxAge: TX_TTL });
      return c.redirect(authorizeUrl(config, tx, await pkceChallenge(verifier)));
    } catch (e) {
      return fail(e instanceof HostNotAllowedError ? e.message : 'Could not start login');
    }
  });

  app.get('/auth/callback', async (c) => {
    const fail = (message: string) => c.redirect(`/?error=${encodeURIComponent(message)}`);
    const token = getCookie(c, TX_COOKIE);
    deleteCookie(c, TX_COOKIE, { path: '/' });
    const tx = token ? await unseal<OAuthTx>(config.sessionKey, token) : null;
    const { code, state, error, error_description: description } = c.req.query();
    if (error) return fail(description || error);
    if (!tx || !code || !state || state !== tx.state) return fail('Login expired or was tampered with. Try again.');
    try {
      await startSession(c, await exchangeCode(config, fetchFn, tx, code));
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

  app.get('/api/session', (c) => {
    const s = c.get('session');
    return c.json({
      connected: Boolean(s),
      instanceHost: s ? new URL(s.instanceUrl).host : null,
      mock: config.mock,
      defaultClientConfigured: Boolean(config.clientId),
    });
  });

  app.use('/api/*', async (c, next) => {
    const session = c.get('session');
    if (!session) return c.json({ error: 'not_connected', message: 'Not connected' }, 401);
    if (session.mock) {
      if (!mockClient) return c.json({ error: 'server_error', message: 'Mock client is not configured' }, 500);
      c.set('client', mockClient);
      return next();
    }
    const holder: SessionHolder = { current: session, refreshed: false };
    c.set('client', createConnectClient(config, fetchFn, holder));
    await next();
    if (holder.refreshed) await startSession(c, holder.current);
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
  const intOf = (v: string | undefined, fallback: number, min: number, max: number): number => {
    const n = v === undefined ? fallback : Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new RangeError(`Expected an integer between ${min} and ${max}`);
    return n;
  };

  app.get('/api/dataspaces', async (c) => c.json(await c.get('client')!.listDataSpaces()));

  app.get('/api/metadata', async (c) => c.json(await c.get('client')!.getMetadata(dataspaceOf(c))));

  app.post('/api/query', async (c) => {
    const body = queryBody.parse(await c.req.json());
    const params = toSqlParameters(body.sql, body.paramDefs as ParamDef[], body.params);
    const started = Date.now();
    const res = await c.get('client')!.submitQuery({
      sql: body.sql,
      dataspace: body.dataspace,
      params,
      rowLimit: config.firstChunkRows,
    });
    return c.json({ ...res, elapsedMs: Date.now() - started } satisfies QueryResponse);
  });

  app.get('/api/query/:id', async (c) => {
    const wait = intOf(c.req.query('wait'), 0, 0, 10_000);
    return c.json(await c.get('client')!.getStatus(idOf(c), dataspaceOf(c), wait));
  });

  app.get('/api/query/:id/rows', async (c) => {
    const offset = intOf(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intOf(c.req.query('limit'), 1000, 1, 5000);
    return c.json(await c.get('client')!.getRows(idOf(c), dataspaceOf(c), offset, limit));
  });

  app.delete('/api/query/:id', async (c) => {
    await c.get('client')!.cancel(idOf(c), dataspaceOf(c));
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
    if (err instanceof RangeError || err instanceof SyntaxError || (err instanceof Error && /^(Parameter|Missing value)/.test(err.message))) {
      return c.json({ error: 'bad_request', message: err.message }, 400);
    }
    console.error(err);
    return c.json({ error: 'server_error', message: 'Unexpected server error' }, 500);
  });

  return app;
}

// ------------------------------------------------------------------- csv

function csvCell(v: CellValue): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralize spreadsheet formula injection from org data.
  if (typeof v === 'string' && /^([=+@\t\r]|-[^0-9.])/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvLine(row: CellValue[] | string[]): string {
  return row.map(csvCell).join(',');
}
