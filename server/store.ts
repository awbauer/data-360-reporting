import { createAdminStore } from './admin-store';
import { createPlanStore } from './plan-store';
import type { SqlDatabase } from './db';
import type { ParamDef } from '../shared/types';

export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled';
export type RunSource = 'editor' | 'explorer' | 'overview' | 'library' | 'credits';

export interface RunRecord {
  id: string;
  userId: string;
  userEmail: string;
  instanceHost: string;
  sfOrgId: string | null;
  sfUserId: string | null;
  dataspace: string;
  source: RunSource;
  sql: string;
  paramDefs: ParamDef[];
  params: Record<string, string>;
  queryId: string | null;
  status: RunStatus;
  rowCount: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  /** The browser's estimate of rows the run reads (see shared/estimate.ts); null when it had none. */
  estRows: number | null;
  /** False when estRows is only a lower bound because some object's size was unknown. */
  estComplete: boolean | null;
}

interface RunRow {
  id: string;
  user_id: string;
  user_email: string;
  instance_host: string;
  sf_org_id: string | null;
  sf_user_id: string | null;
  dataspace: string;
  source: RunSource;
  sql_text: string;
  param_defs: string;
  params: string;
  query_id: string | null;
  status: RunStatus;
  row_count: number | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
  est_rows: number | null;
  est_complete: number | null;
}

const fromRow = (r: RunRow): RunRecord => ({
  id: r.id,
  userId: r.user_id,
  userEmail: r.user_email,
  instanceHost: r.instance_host,
  sfOrgId: r.sf_org_id,
  sfUserId: r.sf_user_id,
  dataspace: r.dataspace,
  source: r.source,
  sql: r.sql_text,
  paramDefs: JSON.parse(r.param_defs) as ParamDef[],
  params: JSON.parse(r.params) as Record<string, string>,
  queryId: r.query_id,
  status: r.status,
  rowCount: r.row_count,
  error: r.error,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  estRows: r.est_rows,
  estComplete: r.est_complete === null ? null : r.est_complete === 1,
});

export interface AuditFilter {
  email?: string;
  host?: string;
  before?: number;
  limit: number;
}

export function createStore(db: SqlDatabase) {
  return {
    ...createAdminStore(db),
    ...createPlanStore(db),
    async logRun(r: RunRecord): Promise<void> {
      await db
        .prepare(
          `insert into query_log (id, user_id, user_email, instance_host, sf_org_id, sf_user_id, dataspace, source, sql_text,
             param_defs, params, query_id, status, row_count, error, started_at, finished_at, est_rows, est_complete)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          r.id, r.userId, r.userEmail, r.instanceHost, r.sfOrgId, r.sfUserId, r.dataspace, r.source, r.sql,
          JSON.stringify(r.paramDefs), JSON.stringify(r.params), r.queryId, r.status, r.rowCount, r.error, r.startedAt, r.finishedAt,
          r.estRows, r.estComplete === null ? null : r.estComplete ? 1 : 0,
        )
        .run();
    },

    /** Records what Salesforce said about a just-submitted query (or why submitting failed). */
    async updateRun(id: string, p: { queryId?: string | null; status: RunStatus; rowCount?: number | null; error?: string | null; finishedAt?: number | null }) {
      await db
        .prepare(`update query_log set query_id = coalesce(?, query_id), status = ?, row_count = ?, error = ?, finished_at = ? where id = ?`)
        .bind(p.queryId ?? null, p.status, p.rowCount ?? null, p.error ?? null, p.finishedAt ?? null, id)
        .run();
    },

    /** Closes a running entry. Scoped to the user so nobody can rewrite someone else's record. */
    async finishRun(userId: string, queryId: string, status: RunStatus, rowCount: number | null, at = Date.now()): Promise<void> {
      await db
        .prepare(`update query_log set status = ?, row_count = ?, finished_at = ? where user_id = ? and query_id = ? and status = 'running'`)
        .bind(status, rowCount, at, userId, queryId)
        .run();
    },

    async history(userId: string, limit: number): Promise<RunRecord[]> {
      const { results } = await db
        .prepare(`select * from query_log where user_id = ? and source = 'editor' and hidden = 0 order by started_at desc limit ?`)
        .bind(userId, limit)
        .all<RunRow>();
      return results.map(fromRow);
    },

    async hideHistory(userId: string): Promise<void> {
      await db.prepare(`update query_log set hidden = 1 where user_id = ?`).bind(userId).run();
    },

    async audit(f: AuditFilter): Promise<RunRecord[]> {
      const where: string[] = [];
      const args: (string | number)[] = [];
      const add = (clause: string, v: string | number) => {
        where.push(clause);
        args.push(v);
      };
      if (f.email) add('user_email = ?', f.email.toLowerCase());
      if (f.host) add('instance_host = ?', f.host.toLowerCase());
      if (f.before) add('started_at < ?', f.before);
      const { results } = await db
        .prepare(`select * from query_log ${where.length ? `where ${where.join(' and ')}` : ''} order by started_at desc limit ?`)
        .bind(...args, f.limit)
        .all<RunRow>();
      return results.map(fromRow);
    },

    /**
     * Estimated rows read, by person and org, since `since`. Sums only runs that had an estimate;
     * `estimated` of `runs` says how much of the picture that is.
     */
    async usage(since: number): Promise<UsageRow[]> {
      const { results } = await db
        .prepare(
          `select user_email, instance_host, count(*) as runs,
                  sum(case when est_rows is not null then 1 else 0 end) as estimated,
                  sum(case when est_complete = 0 then 1 else 0 end) as partial,
                  coalesce(sum(est_rows), 0) as est_rows,
                  min(started_at) as first_at, max(started_at) as last_at
           from query_log where started_at >= ?
           group by user_email, instance_host order by est_rows desc, runs desc`,
        )
        .bind(since)
        .all<{ user_email: string; instance_host: string; runs: number; estimated: number; partial: number; est_rows: number; first_at: number; last_at: number }>();
      return results.map((r) => ({
        userEmail: r.user_email,
        instanceHost: r.instance_host,
        runs: r.runs,
        estimatedRuns: r.estimated,
        partialRuns: r.partial,
        estRows: r.est_rows,
        firstAt: r.first_at,
        lastAt: r.last_at,
      }));
    },

    async purgeRuns(olderThan: number): Promise<number> {
      return (await db.prepare(`delete from query_log where started_at < ?`).bind(olderThan).run()).meta.changes;
    },

    async getState(userId: string, key: string): Promise<{ value: unknown; updatedAt: number } | null> {
      const r = await db
        .prepare(`select value, updated_at from user_state where user_id = ? and key = ?`)
        .bind(userId, key)
        .first<{ value: string; updated_at: number }>();
      return r ? { value: JSON.parse(r.value) as unknown, updatedAt: r.updated_at } : null;
    },

    async putState(userId: string, key: string, json: string, at = Date.now()): Promise<void> {
      await db
        .prepare(
          `insert into user_state (user_id, key, value, updated_at) values (?, ?, ?, ?)
           on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(userId, key, json, at)
        .run();
    },

    async listCredentials(userId: string): Promise<SavedCredential[]> {
      const { results } = await db
        .prepare(`select id, label, client_id, login_host, secret_enc is not null as has_secret, created_at, last_used_at
                  from sf_credentials where user_id = ? order by coalesce(last_used_at, created_at) desc`)
        .bind(userId)
        .all<{ id: string; label: string; client_id: string; login_host: string | null; has_secret: number; created_at: number; last_used_at: number | null }>();
      return results.map((r) => ({
        id: r.id,
        label: r.label,
        clientIdHint: maskClientId(r.client_id),
        loginHost: r.login_host,
        hasSecret: Boolean(r.has_secret),
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
      }));
    },

    async getCredential(userId: string, id: string): Promise<{ clientId: string; secretEnc: string | null; loginHost: string | null } | null> {
      const r = await db
        .prepare(`select client_id, secret_enc, login_host from sf_credentials where user_id = ? and id = ?`)
        .bind(userId, id)
        .first<{ client_id: string; secret_enc: string | null; login_host: string | null }>();
      return r ? { clientId: r.client_id, secretEnc: r.secret_enc, loginHost: r.login_host } : null;
    },

    async saveCredential(
      userId: string,
      c: { id: string; label: string; clientId: string; secretEnc: string | null; loginHost: string | null },
      at = Date.now(),
    ) {
      await db
        .prepare(`insert into sf_credentials (id, user_id, label, client_id, secret_enc, login_host, created_at) values (?, ?, ?, ?, ?, ?, ?)`)
        .bind(c.id, userId, c.label, c.clientId, c.secretEnc, c.loginHost, at)
        .run();
    },

    /** Fills in the login host of a connection saved before hosts were remembered. */
    async setCredentialLoginHost(userId: string, id: string, loginHost: string): Promise<void> {
      await db.prepare(`update sf_credentials set login_host = ? where user_id = ? and id = ? and login_host is null`).bind(loginHost, userId, id).run();
    },

    async touchCredential(userId: string, id: string, at = Date.now()): Promise<void> {
      await db.prepare(`update sf_credentials set last_used_at = ? where user_id = ? and id = ?`).bind(at, userId, id).run();
    },

    async deleteCredential(userId: string, id: string): Promise<boolean> {
      return (await db.prepare(`delete from sf_credentials where user_id = ? and id = ?`).bind(userId, id).run()).meta.changes > 0;
    },
  };
}

export type Store = ReturnType<typeof createStore>;

export interface UsageRow {
  userEmail: string;
  instanceHost: string;
  runs: number;
  /** Runs that carried an estimate (the rest read objects the browser had never counted). */
  estimatedRuns: number;
  /** Of those, runs whose estimate is only a lower bound. */
  partialRuns: number;
  estRows: number;
  firstAt: number;
  lastAt: number;
}

/** Enough of a consumer key to tell saved connections apart; the page never needs the whole key. */
export function maskClientId(id: string): string {
  return id.length <= 12 ? `${id.slice(0, 4)}…` : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export interface SavedCredential {
  id: string;
  label: string;
  clientIdHint: string;
  /** e.g. https://login.salesforce.com; null for connections saved before hosts were stored. */
  loginHost: string | null;
  hasSecret: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}
