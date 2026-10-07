import type { BrowserContext } from '@playwright/test';
import { createAuth } from '../server/auth';
import { loadConfig } from '../server/config';
import { openNodeDatabase } from '../server/node-db';
import { LIVE_SESSION_KEY } from '../playwright.config';

/**
 * Signs `email` in to the live (non-mock) e2e server without GitHub/Google: a second Better Auth
 * instance over the same SQLite file and secret creates a verified user and session, and the
 * session cookie goes into the browser context. The server itself never enables password sign-in.
 */
export async function liveSignIn(context: BrowserContext, base: string, email: string) {
  const config = loadConfig({ APP_BASE_URL: base, SESSION_KEY: LIVE_SESSION_KEY, AUTH_ALLOWED_DOMAINS: 'example.com', DATABASE_PATH: process.env.D360_E2E_DB });
  const { raw } = openNodeDatabase(config.databasePath);
  const auth = createAuth(config, raw, { passwordSignIn: true });
  const ctx = await auth.$context;
  const password = 'e2e-password-not-secret';
  if (!(await ctx.internalAdapter.findUserByEmail(email))) {
    const now = new Date();
    const user = await ctx.adapter.create<{ id: string }>({ model: 'user', data: { email, name: 'E2E', emailVerified: true, createdAt: now, updatedAt: now } });
    await ctx.adapter.create({ model: 'account', data: { userId: user.id, providerId: 'credential', accountId: user.id, password: await ctx.password.hash(password), createdAt: now, updatedAt: now } });
  }
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const url = new URL(base);
  await context.addCookies(
    res.headers.getSetCookie().map((line) => {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      return { name: pair!.slice(0, eq), value: pair!.slice(eq + 1), domain: url.hostname, path: '/', httpOnly: true, sameSite: 'Lax' as const };
    }),
  );
}
