import { loadConfig, type Config } from '../server/config';
import { createApp } from '../server/app';
import { createAuth } from '../server/auth';
import { createMockClient } from '../server/data360/mock/client';
import { openNodeDatabase } from '../server/node-db';
import type { FetchLike } from '../server/oauth';
import { createStore } from '../server/store';

export const SESSION_KEY = 's'.repeat(40);
export const BASE = 'https://wb.example.com';

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    SESSION_KEY,
    SF_CLIENT_ID: 'CLIENTID1234567890',
    SF_CLIENT_SECRET: 'sekret',
    APP_BASE_URL: BASE,
    AUTH_ALLOWED_DOMAINS: 'example.com',
    AUTH_ADMIN_EMAILS: 'admin@example.org',
    ...over,
  });
}

/** Collect Set-Cookie headers into a Cookie request header value. */
export function cookieJar() {
  const jar = new Map<string, string>();
  return {
    absorb(res: Response) {
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const eq = pair!.indexOf('=');
        const name = pair!.slice(0, eq);
        const value = pair!.slice(eq + 1);
        if (!value || /max-age=0/i.test(line)) jar.delete(name);
        else jar.set(name, value);
      }
      return res;
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    has: (name: string) => jar.has(name),
    clear: () => jar.clear(),
  };
}

export type Jar = ReturnType<typeof cookieJar>;

function build(config: Config, fetchFn?: FetchLike) {
  const { raw, db } = openNodeDatabase(':memory:');
  const store = createStore(db);
  // Password sign-in lets tests create users without GitHub/Google; real config never enables it.
  const auth = createAuth(config, raw, { store, passwordSignIn: true });
  const app = createApp({
    config,
    auth,
    store,
    ...(config.mock ? { mockClient: createMockClient() } : {}),
    ...(fetchFn ? { fetch: fetchFn } : {}),
  });
  const send = (jar: Jar, path: string, init: RequestInit = {}) =>
    Promise.resolve(app.request(path, { ...init, headers: { origin: BASE, ...(init.headers as Record<string, string>), cookie: jar.header() } })).then(jar.absorb);

  /**
   * Creates (or reuses) a password user, as a provider sign-in would with `verified` as the
   * provider's email verification, and signs the jar in.
   */
  const signIn = async (jar: Jar, email: string, verified = true) => {
    const password = 'correct-horse-battery';
    const ctx = await auth.$context;
    if (!(await ctx.internalAdapter.findUserByEmail(email))) {
      // Straight to the adapter: the allowlist gate (validateUserInfo) only applies to real sign-in flows.
      const now = new Date();
      const user = await ctx.adapter.create<{ id: string }>({
        model: 'user',
        data: { email, name: email.split('@')[0]!, emailVerified: verified, createdAt: now, updatedAt: now },
      });
      await ctx.adapter.create({
        model: 'account',
        data: { userId: user.id, providerId: 'credential', accountId: user.id, password: await ctx.password.hash(password), createdAt: now, updatedAt: now },
      });
    }
    jar.clear();
    const res = await send(jar, '/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  };
  return { app, auth, db, store, config, send, signIn };
}

export function mockApp() {
  return build(testConfig({ DATA360_MOCK: '1' }));
}

/**
 * A non-mock app whose `request` is already signed in to the app as `email` (lazily, on first
 * use). Callers pass their own cookie header for the Salesforce-side cookies as before.
 */
export function realApp(fetchFn: FetchLike, over: Record<string, string> = {}, email = 'alice@example.com') {
  const b = build(testConfig(over), fetchFn);
  const authJar = cookieJar();
  let ready: Promise<void> | undefined;
  const request = async (path: string, init: RequestInit = {}) => {
    ready ??= b.signIn(authJar, email);
    await ready;
    const h = { ...(init.headers as Record<string, string> | undefined) };
    const cookie = [authJar.header(), h.cookie].filter(Boolean).join('; ');
    return b.app.request(path, { ...init, headers: { origin: BASE, ...h, cookie } });
  };
  return { ...b, request, authJar };
}

export const H = { 'x-d360': '1', 'content-type': 'application/json' };
