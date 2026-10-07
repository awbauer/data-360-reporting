import { beforeAll, describe, expect, it } from 'vitest';
import { newItem, newPlan, type CreditPlan } from '../shared/credits';
import { cookieJar, H, mockApp } from './helpers';

const { app, send, signIn } = mockApp();
const alice = cookieJar();
const bob = cookieJar();

const plan = (over: Partial<CreditPlan> = {}): CreditPlan => ({
  ...newPlan('Acme Year 1'),
  client: 'Acme',
  start: '2026-11',
  entitlement: 2_000_000,
  items: [newItem('unification', 'u1', { initial: 8e6, perRun: 1e5, assumption: '5% daily change' })],
  ...over,
});
const post = (jar: typeof alice, body: unknown) => send(jar, '/api/plans', { method: 'POST', headers: H, body: JSON.stringify(body) });
const put = (jar: typeof alice, id: string, body: unknown) => send(jar, `/api/plans/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });

beforeAll(async () => {
  // Signed in to the app but never connected to Salesforce: plans must still work.
  await signIn(alice, 'alice@example.com');
  await signIn(bob, 'bob@example.com');
});

describe('credit plans API', () => {
  it('needs a signed-in user', async () => {
    expect((await app.request('/api/plans')).status).toBe(401);
  });

  it('works without a Salesforce connection', async () => {
    expect((await send(alice, '/api/dataspaces')).status).toBe(401);
    const res = await post(alice, { plan: plan() });
    expect(res.status).toBe(201);
    const { id, updatedAt } = await res.json();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const list = await (await send(alice, '/api/plans')).json();
    expect(list).toEqual([{ id, name: 'Acme Year 1', client: 'Acme', createdAt: updatedAt, updatedAt }]);
    const got = await (await send(alice, `/api/plans/${id}`)).json();
    expect(got.plan).toEqual(plan());
  });

  it('keeps plans to their owner', async () => {
    const { id } = await (await post(alice, { plan: plan({ name: 'Private' }) })).json();
    expect((await send(bob, `/api/plans/${id}`)).status).toBe(404);
    expect((await put(bob, id, { plan: plan(), baseUpdatedAt: 0 })).status).toBe(404);
    expect((await send(bob, `/api/plans/${id}`, { method: 'DELETE', headers: H })).status).toBe(404);
    expect((await (await send(bob, '/api/plans')).json()).map((p: { id: string }) => p.id)).not.toContain(id);
  });

  it('saves over the version read, and refuses a save based on a stale one', async () => {
    const { id, updatedAt } = await (await post(alice, { plan: plan() })).json();
    const first = await put(alice, id, { plan: plan({ months: 24 }), baseUpdatedAt: updatedAt });
    expect(first.status).toBe(200);
    const next = (await first.json()).updatedAt;
    expect(next).toBeGreaterThan(updatedAt);
    // A second tab still holding the original version.
    const stale = await put(alice, id, { plan: plan({ months: 6 }), baseUpdatedAt: updatedAt });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe('conflict');
    expect((await (await send(alice, `/api/plans/${id}`)).json()).plan.months).toBe(24);
  });

  it('validates plans and drops unknown keys', async () => {
    for (const bad of [
      plan({ months: 0 }),
      plan({ months: 61 }),
      plan({ name: '  ' }),
      plan({ start: '2026-13' }),
      plan({ items: [{ ...newItem('queries', 'q'), perRun: -1 }] }),
      plan({ items: [{ ...newItem('queries', 'q'), kind: 'mining' as 'queries' }] }),
      plan({ entitlement: Number.NaN }),
    ]) {
      const res = await post(alice, { plan: bad });
      expect(res.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    const { id } = await (await post(alice, { plan: { ...plan(), extra: 'x', items: [{ ...plan().items[0], extra: 1 }] } })).json();
    const got = (await (await send(alice, `/api/plans/${id}`)).json()).plan;
    expect(got.extra).toBeUndefined();
    expect(got.items[0].extra).toBeUndefined();
  });

  it('rejects oversized bodies, bad ids and requests without the CSRF header', async () => {
    expect((await post(alice, { plan: plan({ notes: 'x'.repeat(300_000) }) })).status).toBe(400);
    expect((await send(alice, '/api/plans/not-a-uuid')).status).toBe(400);
    const res = await send(alice, '/api/plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: plan() }) });
    expect(res.status).toBe(403);
  });

  it('deletes', async () => {
    const { id } = await (await post(alice, { plan: plan() })).json();
    expect((await send(alice, `/api/plans/${id}`, { method: 'DELETE', headers: H })).status).toBe(200);
    expect((await send(alice, `/api/plans/${id}`)).status).toBe(404);
  });

  it('caps how many plans one user keeps', async () => {
    const carol = cookieJar();
    await signIn(carol, 'carol@example.com');
    for (let i = 0; i < 50; i++) expect((await post(carol, { plan: plan({ name: `P${i}` }) })).status).toBe(201);
    const res = await post(carol, { plan: plan() });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/at most 50/);
  });
});
