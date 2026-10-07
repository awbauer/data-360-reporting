import { betterAuth } from 'better-auth';
import type { GithubProfile } from 'better-auth/social-providers';
import type { Config } from './config';

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
export function createAuth(config: Config, database: unknown, opts: { passwordSignIn?: boolean } = {}) {
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
    },
    telemetry: { enabled: false },
    user: {
      // Runs before a user is created or a provider is linked, and again on every returning OAuth
      // sign-in with the provider's fresh email, so someone whose address moves off the allowlist
      // can't sign in again. The request gate re-checks the stored user on every API call too.
      validateUserInfo: ({ user }) =>
        isAllowed(config, { email: String(user.email ?? ''), emailVerified: user.emailVerified === true })
          ? undefined
          : { error: 'not_allowed', errorDescription: 'This account is not on the allowlist' },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
