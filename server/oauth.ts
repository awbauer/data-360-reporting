import type { Config } from './config';
import { assertAllowedOrigin } from './hosts';

export interface Session {
  accessToken: string;
  refreshToken?: string;
  instanceUrl: string;
  loginHost: string;
  clientId: string;
  /** Secret the user supplied for their own app; lives only inside the sealed session cookie. */
  clientSecret?: string;
  /** From the token response's identity URL (…/id/<orgId>/<userId>), for the audit log. */
  orgId?: string;
  userId?: string;
  mock?: boolean;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OAuthTx {
  verifier: string;
  state: string;
  loginHost: string;
  clientId: string;
  clientSecret?: string;
}

export class OAuthError extends Error {}

/**
 * A secret the user supplied wins. Otherwise only the app's own configured client uses the
 * server's secret; any other consumer key signs in with PKCE alone.
 */
function clientSecretFor(config: Config, clientId: string, supplied?: string): string | undefined {
  return supplied ?? (clientId === config.clientId ? config.clientSecret : undefined);
}

export function authorizeUrl(config: Config, tx: OAuthTx, challenge: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: tx.clientId,
    redirect_uri: `${config.appBaseUrl}/auth/callback`,
    scope: config.scopes,
    state: tx.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${tx.loginHost}/services/oauth2/authorize?${q}`;
}

async function tokenRequest(
  config: Config,
  fetchFn: FetchLike,
  loginHost: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetchFn(`${loginHost}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new OAuthError(String(json.error_description ?? json.error ?? `Token endpoint returned ${res.status}`));
  }
  return json;
}

export async function exchangeCode(
  config: Config,
  fetchFn: FetchLike,
  tx: OAuthTx,
  code: string,
): Promise<Session> {
  const secret = clientSecretFor(config, tx.clientId, tx.clientSecret);
  const json = await tokenRequest(config, fetchFn, tx.loginHost, {
    grant_type: 'authorization_code',
    code,
    client_id: tx.clientId,
    redirect_uri: `${config.appBaseUrl}/auth/callback`,
    code_verifier: tx.verifier,
    ...(secret ? { client_secret: secret } : {}),
  });
  if (typeof json.access_token !== 'string' || typeof json.instance_url !== 'string') {
    throw new OAuthError('Token response was missing access_token or instance_url');
  }
  return {
    accessToken: json.access_token,
    ...(typeof json.refresh_token === 'string' ? { refreshToken: json.refresh_token } : {}),
    instanceUrl: assertAllowedOrigin(json.instance_url, config.allowedHostSuffixes),
    loginHost: tx.loginHost,
    clientId: tx.clientId,
    ...(tx.clientSecret ? { clientSecret: tx.clientSecret } : {}),
    ...identityOf(json.id),
  };
}

/** Salesforce returns `id` as https://login.salesforce.com/id/<orgId>/<userId>. */
export function identityOf(id: unknown): { orgId?: string; userId?: string } {
  const m = typeof id === 'string' ? /\/id\/(00D[A-Za-z0-9]{12,15})\/(005[A-Za-z0-9]{12,15})$/.exec(id) : null;
  return m ? { orgId: m[1]!, userId: m[2]! } : {};
}

/** Returns a refreshed session, or null when it can't be refreshed. */
export async function refreshSession(config: Config, fetchFn: FetchLike, s: Session): Promise<Session | null> {
  if (!s.refreshToken) return null;
  try {
    const secret = clientSecretFor(config, s.clientId, s.clientSecret);
    const json = await tokenRequest(config, fetchFn, s.loginHost, {
      grant_type: 'refresh_token',
      refresh_token: s.refreshToken,
      client_id: s.clientId,
      ...(secret ? { client_secret: secret } : {}),
    });
    if (typeof json.access_token !== 'string') return null;
    return {
      ...s,
      accessToken: json.access_token,
      ...(typeof json.instance_url === 'string'
        ? { instanceUrl: assertAllowedOrigin(json.instance_url, config.allowedHostSuffixes) }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function revokeToken(fetchFn: FetchLike, s: Session): Promise<void> {
  try {
    await fetchFn(`${s.loginHost}/services/oauth2/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: s.refreshToken ?? s.accessToken }),
    });
  } catch {
    /* best effort */
  }
}
