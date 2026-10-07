import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { AppUser } from './auth';
import type { Store } from './store';
import { ACTIVITIES, MAX_MONTHS, RATE_CARDS, type ActivityKind, type CreditPlan, type RateCardId } from '../shared/credits';

const MAX_PLANS = 50;
const MAX_BODY_BYTES = 256 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const amount = (max: number) => z.number().finite().nonnegative().max(max);
const month = z.number().int().min(1).max(MAX_MONTHS);

const itemSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(ACTIVITIES.map((a) => a.kind) as [ActivityKind, ...ActivityKind[]]),
  label: z.string().max(200),
  perRun: amount(1e15),
  runsPerMonth: amount(100_000),
  initial: amount(1e15),
  startMonth: month,
  endMonth: month.optional(),
  env: z.enum(['production', 'sandbox']),
  assumption: z.string().max(2000).optional(),
  source: z.string().max(300).optional(),
});

/** Unknown keys are dropped; numbers are bounded so a plan can't make the estimator misbehave. */
export const planSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(120),
  client: z.string().trim().max(120).optional(),
  cardId: z.enum(Object.keys(RATE_CARDS) as [RateCardId, ...RateCardId[]]),
  overrides: z.record(z.string().max(64), amount(1e7)).refine((o) => Object.keys(o).length <= 50, 'Too many overrides').optional(),
  start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM').optional(),
  months: month,
  entitlement: amount(1e13).optional(),
  pricePer100k: amount(1e9).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected a 3-letter currency code').optional(),
  growthPct: z.number().finite().min(-100).max(1000),
  items: z.array(itemSchema).max(500),
  actuals: z.array(z.object({ month, credits: amount(1e13) })).max(MAX_MONTHS),
  notes: z.string().max(10_000).optional(),
});

type Ctx = Context<{ Variables: { user?: AppUser } }>;

async function bodyOf<T extends z.ZodTypeAny>(c: Ctx, schema: T): Promise<z.infer<T>> {
  const text = await c.req.text();
  if (text.length > MAX_BODY_BYTES) throw new RangeError('That plan is too large to save');
  return schema.parse(JSON.parse(text)) as z.infer<T>;
}

const idOf = (c: Ctx) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new RangeError('Invalid plan id');
  return id;
};

/**
 * Credit plans: per user, and usable before any Salesforce org is connected (an estimate often
 * comes before the org exists). Register before the middleware that requires a connection.
 */
export function registerPlanRoutes<E extends { Variables: { user?: AppUser } }>(app: Hono<E>, { store }: { store: Store }) {
  const a = app as unknown as Hono<{ Variables: { user?: AppUser } }>;
  const uid = (c: Ctx) => c.get('user')!.id;
  const notFound = (c: Ctx) => c.json({ error: 'not_found', message: 'That plan no longer exists.' }, 404);

  a.get('/api/plans', async (c) => c.json(await store.listPlans(uid(c))));

  a.post('/api/plans', async (c) => {
    const { plan } = await bodyOf(c, z.object({ plan: planSchema }));
    if ((await store.countPlans(uid(c))) >= MAX_PLANS) throw new RangeError(`You can keep at most ${MAX_PLANS} plans. Delete one first.`);
    const id = crypto.randomUUID();
    const at = Date.now();
    await store.createPlan(uid(c), id, plan as CreditPlan, at);
    return c.json({ id, createdAt: at, updatedAt: at }, 201);
  });

  a.get('/api/plans/:id', async (c) => {
    const id = idOf(c);
    const row = await store.getPlan(uid(c), id);
    return row ? c.json({ id, ...row }) : notFound(c);
  });

  a.put('/api/plans/:id', async (c) => {
    const id = idOf(c);
    const { plan, baseUpdatedAt } = await bodyOf(c, z.object({ plan: planSchema, baseUpdatedAt: z.number().int().nonnegative() }));
    const r = await store.updatePlan(uid(c), id, plan as CreditPlan, baseUpdatedAt);
    if (r.ok) return c.json({ updatedAt: r.updatedAt });
    if (r.reason === 'not_found') return notFound(c);
    return c.json({ error: 'conflict', message: 'This plan was changed in another tab or on another device. Reload it to see those changes.' }, 409);
  });

  a.delete('/api/plans/:id', async (c) => ((await store.deletePlan(uid(c), idOf(c))) ? c.json({ ok: true }) : notFound(c)));
}
