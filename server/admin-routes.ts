import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { isAdmin, type AppUser } from './auth';
import type { Config } from './config';
import type { Store } from './store';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Ctx = Context<{ Variables: { user?: AppUser } }>;

function intOf(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = v === undefined || v === '' ? fallback : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new RangeError(`Expected an integer between ${min} and ${max}`);
  return n;
}

const idOf = (c: Ctx) => {
  const id = c.req.param('id') ?? '';
  if (!ID_RE.test(id)) throw new RangeError('Invalid user id');
  return id;
};

/**
 * User administration for AUTH_ADMIN_EMAILS: the same people who can read the query audit.
 * Every change is written to admin_action, so admins are accountable too.
 */
export function registerAdminRoutes<E extends { Variables: { user?: AppUser } }>(app: Hono<E>, { config, store }: { config: Config; store: Store }) {
  const a = app as unknown as Hono<{ Variables: { user?: AppUser } }>;

  a.use('/api/admin/*', async (c, next) => {
    if (!isAdmin(config, c.get('user')!)) return c.json({ error: 'forbidden', message: 'Admins only' }, 403);
    await next();
  });

  const target = (c: Ctx) => store.findUser(idOf(c));
  const notFound = (c: Ctx) => c.json({ error: 'not_found', message: 'No such user' }, 404);
  const record = (c: Ctx, action: string, t: { id: string; email: string }, detail: string | null = null) =>
    store.recordAction({ adminEmail: c.get('user')!.email, action, targetUserId: t.id, targetEmail: t.email, detail });

  a.get('/api/admin/users', async (c) => c.json(await store.listUsers()));

  a.get('/api/admin/users/:id', async (c) => {
    const user = await store.findUser(idOf(c));
    if (!user) return c.json({ error: 'not_found', message: 'No such user' }, 404);
    const [block, sessions, logins] = await Promise.all([
      store.blockOf(user.id),
      store.sessions(user.id),
      store.logins({ email: user.email, limit: 100 }),
    ]);
    return c.json({ user: { ...user, admin: config.adminEmails.includes(user.email.toLowerCase()) }, block, sessions, logins });
  });

  a.post('/api/admin/users/:id/block', async (c) => {
    const t = await target(c);
    if (!t) return notFound(c);
    const me = c.get('user')!;
    if (t.id === me.id) return c.json({ error: 'bad_request', message: "You can't block yourself." }, 400);
    if (config.adminEmails.includes(t.email.toLowerCase())) {
      return c.json({ error: 'bad_request', message: 'Admins can only be blocked after they are removed from AUTH_ADMIN_EMAILS.' }, 400);
    }
    const { reason } = z.object({ reason: z.string().trim().max(400).optional() }).parse(await c.req.json().catch(() => ({})));
    await store.block(t.id, reason || null, me.email);
    // Blocking also ends every session, so it takes effect everywhere at once.
    const revoked = await store.revokeSessions(t.id);
    await record(c, 'block', t, [reason, `${revoked} session(s) revoked`].filter(Boolean).join(' · '));
    return c.json({ ok: true, revoked });
  });

  a.delete('/api/admin/users/:id/block', async (c) => {
    const t = await target(c);
    if (!t) return notFound(c);
    if (!(await store.unblock(t.id))) return c.json({ error: 'not_found', message: 'That user is not blocked' }, 404);
    await record(c, 'unblock', t);
    return c.json({ ok: true });
  });

  a.post('/api/admin/users/:id/revoke', async (c) => {
    const t = await target(c);
    if (!t) return notFound(c);
    const { sessionId } = z.object({ sessionId: z.string().regex(ID_RE).optional() }).parse(await c.req.json().catch(() => ({})));
    const revoked = await store.revokeSessions(t.id, sessionId);
    await record(c, sessionId ? 'revoke-session' : 'revoke-all-sessions', t, `${revoked} session(s)`);
    return c.json({ ok: true, revoked });
  });

  a.get('/api/admin/logins', async (c) => {
    const q = c.req.query();
    const outcome = q.outcome ? z.enum(['success', 'denied', 'blocked']).parse(q.outcome) : undefined;
    return c.json(
      await store.logins({
        ...(outcome ? { outcome } : {}),
        ...(q.email ? { email: q.email } : {}),
        ...(q.before ? { before: intOf(q.before, 0, 0, Number.MAX_SAFE_INTEGER) } : {}),
        limit: intOf(q.limit, 200, 1, 500),
      }),
    );
  });

  a.get('/api/admin/actions', async (c) => c.json(await store.actions(intOf(c.req.query('limit'), 200, 1, 500))));
}
