import type { Config } from '../config';
import { refreshSession, type FetchLike, type Session } from '../oauth';
import type { ObjectKind } from '../../shared/types';
import {
  normalizeDataSpaces,
  normalizeIdentityResolutions,
  normalizeInsight,
  normalizeMappings,
  normalizeMetadata,
  normalizePage,
  normalizeSegments,
  normalizeStatus,
  normalizeStreams,
  normalizeSubmit,
} from './normalize';
import { UpstreamError, type Data360Client } from './types';

/** Mutable holder so a token refresh can be written back to the cookie. */
export interface SessionHolder {
  current: Session;
  refreshed: boolean;
}

const ENTITY_TYPES: [string, ObjectKind][] = [
  ['DataModelObject', 'dmo'],
  ['DataLakeObject', 'dlo'],
  ['CalculatedInsight', 'ci'],
];

async function readError(res: Response): Promise<UpstreamError> {
  const text = await res.text().catch(() => '');
  let message = text.slice(0, 500) || res.statusText;
  let code: string | undefined;
  try {
    const j = JSON.parse(text) as unknown;
    const first = (Array.isArray(j) ? j[0] : j) as Record<string, unknown> | undefined;
    if (first && typeof first === 'object') {
      code = typeof first.errorCode === 'string' ? first.errorCode : typeof first.error === 'string' ? first.error : undefined;
      const msg = first.message ?? first.error_description ?? first.error;
      const details = first.details;
      message = [msg, typeof details === 'string' ? details : details ? JSON.stringify(details) : '']
        .filter((x) => typeof x === 'string' && x)
        .join(' — ') || message;
    }
  } catch {
    /* keep raw text */
  }
  return new UpstreamError(res.status, message, code);
}

export function createConnectClient(
  config: Config,
  fetchFn: FetchLike,
  holder: SessionHolder,
): Data360Client {
  const base = () => `${holder.current.instanceUrl}/services/data/${config.apiVersion}/ssot`;

  async function call(method: string, path: string, body?: unknown, retried = false): Promise<unknown> {
    const res = await fetchFn(`${base()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${holder.current.accessToken}`,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401 && !retried) {
      const next = await refreshSession(config, fetchFn, holder.current);
      if (next) {
        holder.current = next;
        holder.refreshed = true;
        return call(method, path, body, true);
      }
    }
    if (!res.ok) throw await readError(res);
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  const qs = (o: Record<string, string | number | undefined>): string => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined) p.set(k, String(v));
    return `?${p}`;
  };

  // queryId arrives percent-encoded (it contains %2F) and must not be encoded again.
  const qpath = (id: string) => `/query-sql/${id}`;

  return {
    async listDataSpaces() {
      return normalizeDataSpaces(await call('GET', `/data-spaces${qs({ limit: 4999 })}`));
    },

    async getMetadata(dataspace) {
      const results = await Promise.allSettled(
        ENTITY_TYPES.map(async ([entityType, kind]) =>
          normalizeMetadata(await call('GET', `/metadata${qs({ dataspace, entityType })}`), kind),
        ),
      );
      const objects = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [[ENTITY_TYPES[i]![0], r.reason as Error] as const] : []));
      if (failed.length === results.length) throw failed[0]![1];
      return { objects, warnings: failed.map(([t, e]) => `${t}: ${e.message}`) };
    },

    async getExtras(dataspace) {
      const errors: string[] = [];
      const PAGE = 200;
      const CAP = 1000;

      const streams = async () => {
        const items: ReturnType<typeof normalizeStreams>['items'] = [];
        let total: number | undefined;
        while (items.length < CAP) {
          const page = normalizeStreams(await call('GET', `/data-streams${qs({ limit: PAGE, offset: items.length })}`));
          total = page.totalSize ?? total;
          items.push(...page.items);
          if (page.items.length < PAGE || (total !== undefined && items.length >= total)) break;
        }
        return { total: total ?? items.length, truncated: (total ?? items.length) > items.length, items };
      };

      const segments = async () => {
        const items: ReturnType<typeof normalizeSegments> = [];
        let more = false;
        while (items.length < CAP) {
          const page = normalizeSegments(await call('GET', `/segments${qs({ dataspace, batchSize: PAGE, offset: items.length })}`));
          items.push(...page);
          more = page.length === PAGE;
          if (!more) break;
        }
        return { total: items.length, truncated: more, items };
      };

      const [s, g] = await Promise.allSettled([streams(), segments()]);
      if (s.status === 'rejected') errors.push(`Data streams: ${(s.reason as Error).message}`);
      if (g.status === 'rejected') errors.push(`Segments: ${(g.reason as Error).message}`);
      return {
        dataStreams: s.status === 'fulfilled' ? s.value : null,
        segments: g.status === 'fulfilled' ? g.value : null,
        errors,
      };
    },

    async getMappings(dataspace, dmo, dlo) {
      return normalizeMappings(
        await call('GET', `/data-model-object-mappings${qs({ dataspace, dmoDeveloperName: dmo, dloDeveloperName: dlo })}`),
      );
    },

    async getIdentityResolutions() {
      return normalizeIdentityResolutions(await call('GET', '/identity-resolutions'));
    },

    async getCalculatedInsight(name) {
      return normalizeInsight(await call('GET', `/calculated-insights/${encodeURIComponent(name)}`), name);
    },

    async submitQuery({ sql, dataspace, params, rowLimit }) {
      const body = {
        sql,
        ...(rowLimit ? { rowLimit } : {}),
        ...(params.length ? { sqlParameters: params } : {}),
        querySettings: { query_timeout: `${config.queryTimeoutMs}ms` },
      };
      const path = `/query-sql${qs({ dataspace, workloadName: config.workloadName })}`;
      return normalizeSubmit(await call('POST', path, body));
    },

    async getStatus(queryId, dataspace, waitMs) {
      const wait = Math.min(Math.max(Math.floor(waitMs), 0), 10_000);
      return normalizeStatus(
        await call('GET', `${qpath(queryId)}${qs({ dataspace, workloadName: config.workloadName, waitTimeMs: wait || undefined })}`),
      );
    },

    async getRows(queryId, dataspace, offset, limit) {
      return normalizePage(
        await call('GET', `${qpath(queryId)}/rows${qs({ dataspace, offset, rowLimit: limit, workloadName: config.workloadName })}`),
      );
    },

    async cancel(queryId, dataspace) {
      await call('DELETE', `${qpath(queryId)}${qs({ dataspace, workloadName: config.workloadName })}`);
    },
  };
}
