import { AsyncLocalStorage } from 'node:async_hooks';
import { betterAuth } from 'better-auth';
import type { GithubProfile } from 'better-auth/social-providers';
import type { Config } from './config';
import type { Store } from './store';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
}

/**
 * Whether this person may use the app. Allowlists match only provider-verified emails, so an
 * unverified address on a GitHub account can't claim someone's domain. Mock mode lets anyone in.
 */
export function isAllowed(config: Config, user: Pick<AppUser, 'email' | 'emailVerified'>): boolean {
  if (config.mock) return true;
  if (!user.emailVerified) return false;
  const email = user.email.toLowerCase();
  const domain = email.split('@')[1] ?? '';
  return config.adminEmails.includes(email) || config.allowedEmails.includes(email) || config.allowedDomains.includes(domain);
}

interface GitHubEmail {
  email: string;
  verified: boolean;
  primary: boolean;
}

/**
 * GitHub's default is the account's public or primary email, which for most consultants is a
 * personal address even when their work address is verified on the same account. Prefer a
 * verified address the allowlist accepts, so `jane@publicissapient.com` gets in whatever her
 * primary is. Falls back to Better Auth's own choice (public, then primary).
 */
export async function githubUserInfo(config: Config, accessToken: string, fetchFn: typeof fetch = fetch) {
  const headers = { authorization: `Bearer ${accessToken}`, 'user-agent': 'data360-workbench', accept: 'application/vnd.github+json' };
  const profileRes = await fetchFn('https://api.github.com/user', { headers });
  if (!profileRes.ok) return null;
  const profile = (await profileRes.json()) as GithubProfile;
  const emailsRes = await fetchFn('https://api.github.com/user/emails', { headers });
  const emails = emailsRes.ok ? ((await emailsRes.json()) as GitHubEmail[]) : [];
  const allowed = emails.find((e) => e.verified && isAllowed(config, { email: e.email, emailVerified: true }));
  const fallback = profile.email ?? (emails.find((e) => e.primary) ?? emails[0])?.email;
  const email = allowed?.email ?? fallback;
  if (!email) return null;
  return {
    user: {
      name: profile.name || profile.login,
      email,
      image: profile.avatar_url,
      emailVerified: emails.some((e) => e.email === email && e.verified),
    },
    data: profile,
  };
}

export function isAdmin(config: Config, user: Pick<AppUser, 'email' | 'emailVerified'>): boolean {
  return (config.mock || user.emailVerified) && config.adminEmails.includes(user.email.toLowerCase());
}

/**
 * `database` is the D1 binding on Workers or a node:sqlite DatabaseSync on Node; Better Auth
 * recognises both. Its tables come from migrations/0001_auth.sql.
 */
interface HookContext {
  path?: string;
  params?: Record<string, string>;
  headers?: Headers;
  request?: Request;
}

/** Cloudflare's client IP when present; otherwise the first X-Forwarded-For hop (as reported, not verified). */
export function clientIp(h: Headers | undefined): string | null {
  return h?.get('cf-connecting-ip') ?? h?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

type PendingEvent = Parameters<Store['recordLogin']>[0];
const pending = new AsyncLocalStorage<PendingEvent[]>();

/**
 * Runs a Better Auth request, then writes the sign-in events its hooks produced. They can't be
 * written from inside the hooks: Better Auth wraps sign-up and OAuth callbacks in a transaction
 * (on SQLite), and a refused sign-in rolls back, which would erase the record of the refusal.
 */
export async function withSignInEvents<T>(store: Store, fn: () => Promise<T>): Promise<T> {
  const events: PendingEvent[] = [];
  try {
    return await pending.run(events, fn);
  } finally {
    for (const e of events) await store.recordLogin(e).catch((err: unknown) => console.error('Could not record sign-in event', err));
  }
}

const headersOf = (ctx: HookContext | null | undefined) => ctx?.headers ?? ctx?.request?.headers;
/** "github", "google", or the endpoint for other methods (e.g. "/sign-in/email"). */
const methodOf = (ctx: HookContext | null | undefined) => ctx?.params?.id ?? ctx?.path ?? null;

export function createAuth(config: Config, database: unknown, opts: { store: Store; passwordSignIn?: boolean }) {
  const { store } = opts;
  const record = async (ctx: HookContext | null | undefined, e: { userId: string | null; email: string; outcome: 'success' | 'denied' | 'blocked'; reason?: string; method?: string | null }) => {
    const event: PendingEvent = {
      userId: e.userId,
      email: e.email,
      outcome: e.outcome,
      method: e.method ?? methodOf(ctx),
      ip: clientIp(headersOf(ctx)),
      userAgent: headersOf(ctx)?.get('user-agent') ?? null,
      reason: e.reason ?? null,
    };
    const buffer = pending.getStore();
    if (buffer) buffer.push(event);
    // Called outside an HTTP request (auth.api in scripts): write now. Never let bookkeeping break sign-in.
    else await store.recordLogin(event).catch((err: unknown) => console.error('Could not record sign-in event', err));
  };

  return betterAuth({
    appName: 'Data 360 Workbench',
    baseURL: config.appBaseUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.appBaseUrl],
    database: database as never,
    socialProviders: {
      ...(config.providers.github
        ? {
            github: {
              ...config.providers.github,
              scope: ['read:user', 'user:email'],
              getUserInfo: async (token: { accessToken?: string }) => (token.accessToken ? githubUserInfo(config, token.accessToken) : null),
            },
          }
        : {}),
      ...(config.providers.google ? { google: { ...config.providers.google, prompt: 'select_account' as const } } : {}),
    },
    // Only for the demo user in mock mode (and tests); real deployments sign in with a provider.
    emailAndPassword: { enabled: config.mock || Boolean(opts.passwordSignIn) },
    account: {
      // The app never calls GitHub or Google after sign-in; encrypt the provider tokens anyway.
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, trustedProviders: ['github', 'google'] },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Saves a database read on most requests; a revoked session can live on for up to 5 minutes.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      useSecureCookies: config.secureCookies,
      cookiePrefix: 'd360',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },
    telemetry: { enabled: false },
    user: {
      // Runs before a user is created or a provider is linked, and again on every returning OAuth
      // sign-in with the provider's fresh email, so someone whose address moves off the allowlist
      // can't sign in again. The request gate re-checks the stored user on every API call too.
      // Blocked users are turned away here too, and both refusals land in the sign-in history.
      validateUserInfo: async ({ user, source }, ctx) => {
        const email = String(user.email ?? '').toLowerCase();
        const method = source.oauth?.providerId ?? source.method;
        if (!isAllowed(config, { email, emailVerified: user.emailVerified === true })) {
          await record(ctx as HookContext, { userId: null, email, outcome: 'denied', method, reason: user.emailVerified === true ? 'not on the allowlist' : 'email not verified' });
          return { error: 'not_allowed', errorDescription: 'This account is not on the allowlist' };
        }
        const block = await store.blockOfEmail(email);
        if (block) {
          await record(ctx as HookContext, { userId: null, email, outcome: 'blocked', method, reason: block.reason ?? 'blocked' });
          return { error: 'blocked', errorDescription: 'This account has been blocked' };
        }
        return undefined;
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Backstop for sign-ins validateUserInfo doesn't see (password sign-in in mock mode and tests).
          before: async (session, ctx) => {
            const block = await store.blockOf(session.userId);
            if (!block) return;
            const u = await store.findUser(session.userId);
            await record(ctx as HookContext, { userId: session.userId, email: u?.email ?? '', outcome: 'blocked', reason: block.reason ?? 'blocked' });
            return false;
          },
          after: async (session, ctx) => {
            const u = await store.findUser(session.userId);
            await record(ctx as HookContext, { userId: session.userId, email: u?.email ?? '', outcome: 'success' });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
