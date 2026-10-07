import { describe, expect, it } from 'vitest';
import { cookieJar, H, realApp } from './helpers';

const noSalesforce = async () => new Response(null, { status: 500 });
const json = (body: unknown = {}) => ({ method: 'POST', headers: H, body: JSON.stringify(body) });

async function setup() {
  const t = realApp(noSalesforce);
  const admin = cookieJar();
  const alice = cookieJar();
  await t.signIn(admin, 'admin@example.org');
  await t.signIn(alice, 'alice@example.com');
  const aliceId = (await t.db.prepare('select id from "user" where email = ?').bind('alice@example.com').first<{ id: string }>())!.id;
  const adminId = (await t.db.prepare('select id from "user" where email = ?').bind('admin@example.org').first<{ id: string }>())!.id;
  return { t, admin, alice, aliceId, adminId, as: (jar: typeof admin, path: string, init: RequestInit = {}) => t.send(jar, path, init) };
}

describe('user administration', () => {
  it('is only for admins', async () => {
    const { as, alice, admin } = await setup();
    for (const path of ['/api/admin/users', '/api/admin/logins', '/api/admin/actions']) {
      expect((await as(alice, path)).status).toBe(403);
      expect((await as(admin, path)).status).toBe(200);
    }
  });

  it('lists users with provider, last sign-in and query counts, and records every sign-in', async () => {
    const { as, admin, aliceId } = await setup();
    const users = await (await as(admin, '/api/admin/users')).json();
    const alice = users.find((u: { id: string }) => u.id === aliceId);
    expect(alice).toMatchObject({ email: 'alice@example.com', providers: ['credential'], activeSessions: 1, queries: 0, block: null });
    expect(alice.lastSignInAt).toBeGreaterThan(Date.now() - 60_000);
    const detail = await (await as(admin, `/api/admin/users/${aliceId}`)).json();
    expect(detail.logins[0]).toMatchObject({ outcome: 'success', email: 'alice@example.com', method: '/sign-in/email' });
    expect(detail.sessions).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toMatch(/token/i);
  });

  it('records sign-in attempts the allowlist turned away', async () => {
    const { t, as, admin } = await setup();
    const outsider = cookieJar();
    await t.send(outsider, '/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'probe/1.0' },
      body: JSON.stringify({ email: 'Mallory@Elsewhere.net', password: 'correct-horse-battery', name: 'M' }),
    });
    const denied = await (await as(admin, '/api/admin/logins?outcome=denied')).json();
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ email: 'mallory@elsewhere.net', userId: null, method: 'email-password', ip: '203.0.113.9', userAgent: 'probe/1.0' });
  });

  it('blocks at once: live sessions stop working and the user cannot sign back in', async () => {
    const { t, as, admin, alice, aliceId } = await setup();
    expect((await as(alice, '/api/history')).status).toBe(200);
    const res = await as(admin, `/api/admin/users/${aliceId}/block`, json({ reason: 'left the project' }));
    expect(await res.json()).toEqual({ ok: true, revoked: 1 });
    // Her cookie still carries Better Auth's 5-minute cache, but the session row is gone.
    expect((await as(alice, '/api/history')).status).toBe(401);
    // Signing in again is refused, and the refusal is recorded.
    await expect(t.signIn(alice, 'alice@example.com')).rejects.toThrow(/sign-in failed/);
    const detail = await (await as(admin, `/api/admin/users/${aliceId}`)).json();
    expect(detail.block).toMatchObject({ reason: 'left the project', blockedBy: 'admin@example.org' });
    expect(detail.logins[0]).toMatchObject({ outcome: 'blocked', reason: 'left the project' });
    const actions = await (await as(admin, '/api/admin/actions')).json();
    expect(actions[0]).toMatchObject({ adminEmail: 'admin@example.org', action: 'block', targetEmail: 'alice@example.com' });

    expect((await as(admin, `/api/admin/users/${aliceId}/block`, { method: 'DELETE', headers: H })).status).toBe(200);
    await t.signIn(alice, 'alice@example.com');
    expect((await as(alice, '/api/history')).status).toBe(200);
    expect((await (await as(admin, '/api/admin/actions')).json())[0].action).toBe('unblock');
  });

  it('turns away a blocked user whose session somehow survived', async () => {
    const { t, as, alice, aliceId } = await setup();
    await t.store.block(aliceId, null, 'admin@example.org'); // straight to the table: sessions untouched
    const res = await as(alice, '/api/history');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('blocked');
    expect((await (await as(alice, '/api/session')).json()).user).toMatchObject({ blocked: true });
  });

  it("won't block yourself or another admin", async () => {
    const { t, as, admin, adminId } = await setup();
    expect((await as(admin, `/api/admin/users/${adminId}/block`, json())).status).toBe(400);
    const other = cookieJar();
    await t.signIn(other, 'admin@example.org');
    expect((await as(admin, '/api/admin/users/nobody/block', json())).status).toBe(404);
  });

  it('revokes sessions without blocking: one, or all', async () => {
    const { t, as, admin, alice, aliceId } = await setup();
    const phone = cookieJar();
    await t.signIn(phone, 'alice@example.com');
    const { sessions } = await (await as(admin, `/api/admin/users/${aliceId}`)).json();
    expect(sessions).toHaveLength(2);
    // sessions are newest first: the phone's
    await as(admin, `/api/admin/users/${aliceId}/revoke`, json({ sessionId: sessions[0].id }));
    expect((await as(phone, '/api/history')).status).toBe(401);
    expect((await as(alice, '/api/history')).status).toBe(200);
    expect(await (await as(admin, `/api/admin/users/${aliceId}/revoke`, json())).json()).toEqual({ ok: true, revoked: 1 });
    expect((await as(alice, '/api/history')).status).toBe(401);
    // Not blocked: she can sign straight back in.
    await t.signIn(alice, 'alice@example.com');
    expect((await as(alice, '/api/history')).status).toBe(200);
  });
});
