import type { CreditPlan } from '@shared/credits';
import type { DataSpace, Extras, IdentityRuleset, InsightDefinition, MappingResult, ObjectMeta, ParamDef, QueryChunk, QueryColumn, QueryResponse } from '@shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Status 0: the request never got an answer (offline, DNS, the connection dropped). */
export const NETWORK_ERROR = 0;

/**
 * A plain-text or HTML error page (a proxy, a Worker that failed before the app started) carries
 * no JSON. Use its text when it is a short sentence, otherwise say only what the status means.
 */
function messageFromText(status: number, text: string): string {
  const plain = text.trim();
  if (plain && plain.length <= 300 && !/^\s*</.test(plain)) return plain;
  if (status >= 500) return `The server ran into a problem (HTTP ${status}). Try again shortly.`;
  return `Request failed (HTTP ${status}).`;
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const mutating = rest.method && rest.method !== 'GET';
  let res: Response;
  let text: string;
  try {
    res = await fetch(path, {
      ...rest,
      headers: {
        ...(mutating ? { 'x-d360': '1' } : {}),
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    text = await res.text();
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(NETWORK_ERROR, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  let body: unknown = null;
  let parsed = !text;
  if (text) {
    try {
      body = JSON.parse(text);
      parsed = true;
    } catch {
      // handled below: an error page, or an HTML page where JSON was expected
    }
  }
  if (!res.ok) {
    const e = (parsed && body && typeof body === 'object' ? body : {}) as { error?: unknown; message?: unknown };
    const message = typeof e.message === 'string' && e.message ? e.message : messageFromText(res.status, parsed ? '' : text);
    throw new ApiError(res.status, typeof e.error === 'string' ? e.error : 'error', message);
  }
  if (!parsed) throw new ApiError(res.status, 'bad_response', 'The server sent a response the app could not read. Reload the page and try again.');
  return body as T;
}

export interface AppUserInfo {
  email: string;
  name: string;
  image: string | null;
  allowed: boolean;
  admin: boolean;
  /** An admin blocked this user: everything but sign-out is refused. */
  blocked: boolean;
}

export type Provider = 'github' | 'google';

export interface SessionInfo {
  /** Who is signed in to the app (Better Auth); null when signed out. */
  user: AppUserInfo | null;
  providers: Provider[];
  /** Whether that user has a Salesforce connection. */
  connected: boolean;
  instanceHost: string | null;
  mock: boolean;
  defaultClientConfigured: boolean;
}

/** Production, Sandbox or a My Domain host. */
export interface LoginChoice {
  env?: 'production' | 'sandbox' | 'custom';
  domain?: string;
}

export type CredentialsInput =
  | ({ savedId: string } & LoginChoice)
  | ({ clientId: string; clientSecret?: string; remember?: boolean; label?: string } & LoginChoice);

export interface CredentialsResult {
  /** The key's first and last few characters; the page never gets the whole key back. */
  clientIdHint: string;
  hasSecret: boolean;
  loginHost?: string;
  /** Present when saved credentials were used or `remember` was requested. */
  savedId?: string;
}

/** A consumer key (and maybe secret) the user saved; the secret never leaves the server. */
export interface SavedCredential {
  id: string;
  label: string;
  /** e.g. "3MVG9A…x7Qk". */
  clientIdHint: string;
  /** Where it signs in; null for connections saved before this was stored. */
  loginHost: string | null;
  hasSecret: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface HistoryItem {
  id: string;
  at: string;
  sql: string;
  dataspace: string;
  instanceHost: string;
  paramDefs: ParamDef[];
  params: Record<string, string>;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  rows: number | null;
  elapsedMs: number | null;
  error: string | null;
  estRows: number | null;
  estComplete: boolean | null;
}

export interface UsageRow {
  userEmail: string;
  instanceHost: string;
  runs: number;
  estimatedRuns: number;
  partialRuns: number;
  estRows: number;
  firstAt: number;
  lastAt: number;
}

export interface PlanSummary {
  id: string;
  name: string;
  client: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoredPlan {
  id: string;
  plan: CreditPlan;
  createdAt: number;
  updatedAt: number;
}

export interface AdminBlock {
  reason: string | null;
  blockedBy: string;
  blockedAt: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  providers: string[];
  lastSignInAt: number | null;
  activeSessions: number;
  queries: number;
  lastQueryAt: number | null;
  block: AdminBlock | null;
}

export interface LoginEvent {
  id: string;
  userId: string | null;
  email: string;
  outcome: 'success' | 'denied' | 'blocked';
  method: string | null;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  at: number;
}

export interface AdminSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface AdminUserDetail {
  user: { id: string; email: string; name: string; createdAt: string; admin: boolean };
  block: AdminBlock | null;
  sessions: AdminSession[];
  logins: LoginEvent[];
}

export interface AdminAction {
  id: string;
  adminEmail: string;
  action: string;
  targetUserId: string | null;
  targetEmail: string | null;
  detail: string | null;
  at: number;
}

export interface AuditEntry {
  id: string;
  userEmail: string;
  instanceHost: string;
  sfOrgId: string | null;
  sfUserId: string | null;
  dataspace: string;
  source: string;
  sql: string;
  params: Record<string, string>;
  status: HistoryItem['status'];
  rowCount: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  estRows: number | null;
  estComplete: boolean | null;
}

export interface QueryStatus {
  queryId: string;
  done: boolean;
  progress: number;
  rowCount: number;
}

export interface RunInput {
  sql: string;
  dataspace: string;
  paramDefs?: ParamDef[];
  params?: Record<string, string>;
  /** Where the run came from, for the audit log; History shows only `editor` runs. */
  source?: 'editor' | 'explorer' | 'overview' | 'credits';
  /** Our estimate of rows the run reads, from cached counts (see shared/estimate.ts). */
  estRows?: number;
  /** False when `estRows` is only a lower bound. */
  estComplete?: boolean;
}

const enc = encodeURIComponent;

export type StateKey = 'tabs';

/** App sign-in, served by Better Auth under /api/auth. */
export const appAuth = {
  /** Starts a GitHub/Google sign-in; the browser leaves the app. Errors come back as /?error=<code>. */
  async social(provider: Provider) {
    const { url } = await request<{ url: string }>('/api/auth/sign-in/social', {
      method: 'POST',
      json: { provider, callbackURL: '/', errorCallbackURL: '/' },
    });
    window.location.assign(url);
  },
  /** Mock mode only: a throwaway local account so the demo works without a provider. */
  async demo() {
    const creds = { email: 'demo@example.com', password: 'demo-password-not-secret' };
    try {
      await request('/api/auth/sign-in/email', { method: 'POST', json: creds });
    } catch {
      await request('/api/auth/sign-up/email', { method: 'POST', json: { ...creds, name: 'Demo user' } });
    }
  },
  signOut: () => request<unknown>('/api/auth/sign-out', { method: 'POST', json: {} }),
};

export const api = {
  session: () => request<SessionInfo>('/api/session'),
  /** Park the user's own consumer key/secret in a short-lived sealed cookie before /auth/login. */
  credentials: (input: CredentialsInput) => request<CredentialsResult>('/auth/credentials', { method: 'POST', json: input }),
  savedCredentials: () => request<SavedCredential[]>('/api/credentials'),
  deleteCredential: (id: string) => request<{ ok: true }>(`/api/credentials/${enc(id)}`, { method: 'DELETE' }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  history: () => request<HistoryItem[]>('/api/history'),
  clearHistory: () => request<{ ok: true }>('/api/history', { method: 'DELETE' }),
  audit: (f: { email?: string; host?: string; before?: number }) => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
    return request<AuditEntry[]>(`/api/audit?${q}`);
  },
  auditCsvUrl: (f: { email?: string; host?: string }) =>
    `/api/audit?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), format: 'csv', limit: '50000' })}`,
  admin: {
    users: () => request<AdminUser[]>('/api/admin/users'),
    user: (id: string) => request<AdminUserDetail>(`/api/admin/users/${enc(id)}`),
    block: (id: string, reason: string) => request<{ ok: true; revoked: number }>(`/api/admin/users/${enc(id)}/block`, { method: 'POST', json: { reason } }),
    unblock: (id: string) => request<{ ok: true }>(`/api/admin/users/${enc(id)}/block`, { method: 'DELETE' }),
    revoke: (id: string, sessionId?: string) =>
      request<{ ok: true; revoked: number }>(`/api/admin/users/${enc(id)}/revoke`, { method: 'POST', json: sessionId ? { sessionId } : {} }),
    logins: (f: { outcome?: string; email?: string; before?: number }) => {
      const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
      return request<LoginEvent[]>(`/api/admin/logins?${q}`);
    },
    actions: () => request<AdminAction[]>('/api/admin/actions'),
    usage: (days: number) => request<{ days: number; rows: UsageRow[] }>(`/api/admin/usage?days=${days}`),
  },
  /** Credit plans: per user, and available before any org is connected. */
  plans: {
    list: () => request<PlanSummary[]>('/api/plans'),
    get: (id: string) => request<StoredPlan>(`/api/plans/${enc(id)}`),
    create: (plan: CreditPlan) => request<{ id: string; createdAt: number; updatedAt: number }>('/api/plans', { method: 'POST', json: { plan } }),
    /** Refused with 409 `conflict` if the plan was saved elsewhere since `baseUpdatedAt`. */
    save: (id: string, plan: CreditPlan, baseUpdatedAt: number) =>
      request<{ updatedAt: number }>(`/api/plans/${enc(id)}`, { method: 'PUT', json: { plan, baseUpdatedAt } }),
    remove: (id: string) => request<{ ok: true }>(`/api/plans/${enc(id)}`, { method: 'DELETE' }),
  },
  getState: <T>(key: StateKey) => request<{ value: T; updatedAt: number } | null>(`/api/state/${key}`),
  putState: (key: StateKey, value: unknown) => request<{ ok: true }>(`/api/state/${key}`, { method: 'PUT', json: { value } }),
  identity: (dataspace: string) => request<IdentityRuleset[]>(`/api/identity?dataspace=${enc(dataspace)}`),
  dataspaces: () => request<DataSpace[]>('/api/dataspaces'),
  metadata: (dataspace: string) =>
    request<{ objects: ObjectMeta[]; warnings: string[] }>(`/api/metadata?dataspace=${enc(dataspace)}`),
  extras: (dataspace: string) => request<Extras>(`/api/extras?dataspace=${enc(dataspace)}`),
  /** The DLOs mapped into one DMO. The upstream API has no lookup by DLO alone. */
  mappings: (dataspace: string, dmo: string) => request<MappingResult>(`/api/mappings?dataspace=${enc(dataspace)}&dmo=${enc(dmo)}`),
  insight: (name: string) => request<InsightDefinition>(`/api/insights/${enc(name)}`),
  submit: (input: RunInput) => request<QueryResponse>('/api/query', { method: 'POST', json: input }),
  status: (id: string, dataspace: string, waitMs: number, signal?: AbortSignal) =>
    request<QueryStatus>(`/api/query/${enc(id)}?dataspace=${enc(dataspace)}&wait=${waitMs}`, { signal }),
  rows: (id: string, dataspace: string, offset: number, limit: number) =>
    request<QueryChunk>(`/api/query/${enc(id)}/rows?dataspace=${enc(dataspace)}&offset=${offset}&limit=${limit}`),
  cancel: (id: string, dataspace: string) =>
    request<{ ok: true }>(`/api/query/${enc(id)}?dataspace=${enc(dataspace)}`, { method: 'DELETE' }),
  exportUrl: (id: string, dataspace: string, columns: QueryColumn[]) =>
    `/api/query/${enc(id)}/export.csv?dataspace=${enc(dataspace)}&cols=${enc(JSON.stringify(columns.map((c) => c.name)))}`,
};

export interface CompletedQuery {
  queryId: string;
  columns: QueryColumn[];
  rows: QueryResponse['rows'];
  rowCount: number;
  elapsedMs: number;
}

/**
 * Submit a query, wait for it to finish, and return up to `maxRows` rows.
 * Intended for small result sets (aggregates, top-N); the UI runner pages instead.
 */
export async function runToCompletion(
  input: RunInput,
  opts: { signal?: AbortSignal; maxRows?: number } = {},
): Promise<CompletedQuery> {
  const maxRows = opts.maxRows ?? 5000;
  const started = performance.now();
  const first = await api.submit({ source: 'explorer', ...input });
  let done = first.done;
  while (!done) {
    if (opts.signal?.aborted) {
      void api.cancel(first.queryId, input.dataspace).catch(() => undefined);
      throw new DOMException('Aborted', 'AbortError');
    }
    done = (await api.status(first.queryId, input.dataspace, 8000, opts.signal)).done;
  }
  const rows = [...first.rows];
  while (rows.length < Math.min(first.rowCount, maxRows)) {
    const page = await api.rows(first.queryId, input.dataspace, rows.length, Math.min(1000, maxRows - rows.length));
    if (!page.rows.length) break;
    rows.push(...page.rows);
  }
  return {
    queryId: first.queryId,
    columns: first.columns ?? [],
    rows,
    rowCount: first.rowCount,
    elapsedMs: Math.round(performance.now() - started),
  };
}
