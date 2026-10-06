import type { DataSpace, Extras, ObjectMeta, ParamDef, QueryChunk, QueryColumn, QueryResponse } from '@shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const mutating = rest.method && rest.method !== 'GET';
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(mutating ? { 'x-d360': '1' } : {}),
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(rest.headers as Record<string, string> | undefined),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, e.error ?? 'error', e.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface SessionInfo {
  connected: boolean;
  instanceHost: string | null;
  mock: boolean;
  defaultClientConfigured: boolean;
}

export interface CredentialsInput {
  clientId?: string;
  clientSecret?: string;
  /** Ciphertext from an earlier `remember`. */
  saved?: string;
  remember?: boolean;
}

export interface CredentialsResult {
  clientId: string;
  hasSecret: boolean;
  /** Present when `remember` was requested: encrypted by the server, safe to keep in localStorage. */
  saved?: string;
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
}

const enc = encodeURIComponent;

export const api = {
  session: () => request<SessionInfo>('/api/session'),
  /** Park the user's own consumer key/secret in a short-lived sealed cookie before /auth/login. */
  credentials: (input: CredentialsInput) => request<CredentialsResult>('/auth/credentials', { method: 'POST', json: input }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  dataspaces: () => request<DataSpace[]>('/api/dataspaces'),
  metadata: (dataspace: string) =>
    request<{ objects: ObjectMeta[]; warnings: string[] }>(`/api/metadata?dataspace=${enc(dataspace)}`),
  extras: (dataspace: string) => request<Extras>(`/api/extras?dataspace=${enc(dataspace)}`),
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
  const first = await api.submit(input);
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
