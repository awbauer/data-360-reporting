import type { SqlDatabase } from './db';

export type LoginOutcome = 'success' | 'denied' | 'blocked';

export interface LoginEvent {
  id: string;
  userId: string | null;
  email: string;
  outcome: LoginOutcome;
  method: string | null;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  at: number;
}

export interface Block {
  reason: string | null;
  blockedBy: string;
  blockedAt: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  providers: string[];
  lastSignInAt: number | null;
  activeSessions: number;
  queries: number;
  lastQueryAt: number | null;
  block: Block | null;
}

export interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
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

interface LoginRow {
  id: string;
  user_id: string | null;
  email: string;
  outcome: LoginOutcome;
  method: string | null;
  ip: string | null;
  user_agent: string | null;
  reason: string | null;
  at: number;
}

const toLogin = (r: LoginRow): LoginEvent => ({
  id: r.id, userId: r.user_id, email: r.email, outcome: r.outcome, method: r.method, ip: r.ip, userAgent: r.user_agent, reason: r.reason, at: r.at,
});

const toBlock = (r: { reason: string | null; blocked_by: string; blocked_at: number } | null): Block | null =>
  r ? { reason: r.reason, blockedBy: r.blocked_by, blockedAt: r.blocked_at } : null;

/** Better Auth stores timestamps as ISO strings in SQLite/D1. */
const iso = (ms: number) => new Date(ms).toISOString();

export function createAdminStore(db: SqlDatabase) {
  return {
    async recordLogin(e: Omit<LoginEvent, 'id' | 'at'>, at = Date.now()): Promise<void> {
      await db
        .prepare(`insert into login_event (id, user_id, email, outcome, method, ip, user_agent, reason, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), e.userId, e.email.toLowerCase(), e.outcome, e.method, e.ip?.slice(0, 64) ?? null, e.userAgent?.slice(0, 400) ?? null, e.reason?.slice(0, 400) ?? null, at)
        .run();
    },

    /**
     * One read per request: is this session still in the database (so a revoke takes effect
     * at once, despite Better Auth's cookie cache), and is its user blocked?
     */
    async sessionState(token: string, userId: string, now = Date.now()): Promise<{ live: boolean; block: Block | null }> {
      const r = await db
        .prepare(
          `select exists(select 1 from "session" where "token" = ? and "userId" = ? and "expiresAt" > ?) as live,
                  b.reason, b.blocked_by, b.blocked_at
           from (select 1) left join user_block b on b.user_id = ?`,
        )
        .bind(token, userId, iso(now), userId)
        .first<{ live: number; reason: string | null; blocked_by: string | null; blocked_at: number | null }>();
      return {
        live: Boolean(r?.live),
        block: r?.blocked_by ? toBlock({ reason: r.reason, blocked_by: r.blocked_by, blocked_at: r.blocked_at! }) : null,
      };
    },

    async blockOf(userId: string): Promise<Block | null> {
      return toBlock(await db.prepare(`select reason, blocked_by, blocked_at from user_block where user_id = ?`).bind(userId).first());
    },

    async blockOfEmail(email: string): Promise<Block | null> {
      return toBlock(
        await db
          .prepare(`select b.reason, b.blocked_by, b.blocked_at from user_block b join "user" u on u.id = b.user_id where u.email = ?`)
          .bind(email.toLowerCase())
          .first(),
      );
    },

    async block(userId: string, reason: string | null, by: string, at = Date.now()): Promise<void> {
      await db
        .prepare(
          `insert into user_block (user_id, reason, blocked_by, blocked_at) values (?, ?, ?, ?)
           on conflict (user_id) do update set reason = excluded.reason, blocked_by = excluded.blocked_by, blocked_at = excluded.blocked_at`,
        )
        .bind(userId, reason, by, at)
        .run();
    },

    async unblock(userId: string): Promise<boolean> {
      return (await db.prepare(`delete from user_block where user_id = ?`).bind(userId).run()).meta.changes > 0;
    },

    async findUser(userId: string): Promise<{ id: string; email: string; name: string; createdAt: string } | null> {
      return db.prepare(`select id, email, name, "createdAt" from "user" where id = ?`).bind(userId).first();
    },

    async listUsers(now = Date.now()): Promise<AdminUserRow[]> {
      const { results } = await db
        .prepare(
          `select u.id, u.email, u.name, u."createdAt",
             (select group_concat(distinct a."providerId") from account a where a."userId" = u.id) as providers,
             (select max(at) from login_event l where l.user_id = u.id and l.outcome = 'success') as last_sign_in,
             (select count(*) from "session" s where s."userId" = u.id and s."expiresAt" > ?) as active_sessions,
             (select count(*) from query_log q where q.user_id = u.id) as queries,
             (select max(started_at) from query_log q where q.user_id = u.id) as last_query,
             b.reason, b.blocked_by, b.blocked_at
           from "user" u left join user_block b on b.user_id = u.id
           order by coalesce(last_sign_in, 0) desc, u.email`,
        )
        .bind(iso(now))
        .all<{
          id: string; email: string; name: string; createdAt: string; providers: string | null; last_sign_in: number | null;
          active_sessions: number; queries: number; last_query: number | null; reason: string | null; blocked_by: string | null; blocked_at: number | null;
        }>();
      return results.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        createdAt: r.createdAt,
        providers: r.providers ? r.providers.split(',') : [],
        lastSignInAt: r.last_sign_in,
        activeSessions: r.active_sessions,
        queries: r.queries,
        lastQueryAt: r.last_query,
        block: r.blocked_by ? toBlock({ reason: r.reason, blocked_by: r.blocked_by, blocked_at: r.blocked_at! }) : null,
      }));
    },

    /** Session metadata only: never the token. */
    async sessions(userId: string, now = Date.now()): Promise<SessionRow[]> {
      const { results } = await db
        .prepare(`select id, "createdAt", "expiresAt", "ipAddress", "userAgent" from "session" where "userId" = ? and "expiresAt" > ? order by "createdAt" desc`)
        .bind(userId, iso(now))
        .all<{ id: string; createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null }>();
      return results.map((r) => ({ id: r.id, createdAt: r.createdAt, expiresAt: r.expiresAt, ip: r.ipAddress || null, userAgent: r.userAgent || null }));
    },

    async revokeSessions(userId: string, sessionId?: string): Promise<number> {
      const q = sessionId
        ? db.prepare(`delete from "session" where "userId" = ? and id = ?`).bind(userId, sessionId)
        : db.prepare(`delete from "session" where "userId" = ?`).bind(userId);
      return (await q.run()).meta.changes;
    },

    async logins(f: { userId?: string; email?: string; outcome?: LoginOutcome; before?: number; limit: number }): Promise<LoginEvent[]> {
      const where: string[] = [];
      const args: (string | number)[] = [];
      const add = (clause: string, v: string | number) => {
        where.push(clause);
        args.push(v);
      };
      if (f.userId) add('user_id = ?', f.userId);
      if (f.email) add('email = ?', f.email.toLowerCase());
      if (f.outcome) add('outcome = ?', f.outcome);
      if (f.before) add('at < ?', f.before);
      const { results } = await db
        .prepare(`select * from login_event ${where.length ? `where ${where.join(' and ')}` : ''} order by at desc limit ?`)
        .bind(...args, f.limit)
        .all<LoginRow>();
      return results.map(toLogin);
    },

    async recordAction(a: Omit<AdminAction, 'id' | 'at'>, at = Date.now()): Promise<void> {
      await db
        .prepare(`insert into admin_action (id, admin_email, action, target_user_id, target_email, detail, at) values (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), a.adminEmail, a.action, a.targetUserId, a.targetEmail, a.detail, at)
        .run();
    },

    async actions(limit: number): Promise<AdminAction[]> {
      const { results } = await db
        .prepare(`select * from admin_action order by at desc limit ?`)
        .bind(limit)
        .all<{ id: string; admin_email: string; action: string; target_user_id: string | null; target_email: string | null; detail: string | null; at: number }>();
      return results.map((r) => ({
        id: r.id, adminEmail: r.admin_email, action: r.action, targetUserId: r.target_user_id, targetEmail: r.target_email, detail: r.detail, at: r.at,
      }));
    },

    async purgeLogins(olderThan: number): Promise<number> {
      return (await db.prepare(`delete from login_event where at < ?`).bind(olderThan).run()).meta.changes;
    },
  };
}

export type AdminStore = ReturnType<typeof createAdminStore>;
