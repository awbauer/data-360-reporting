import type { SqlDatabase } from './db';
import type { CreditPlan } from '../shared/credits';

export interface PlanSummary {
  id: string;
  name: string;
  client: string | null;
  createdAt: number;
  updatedAt: number;
}

export type PlanUpdate = { ok: true; updatedAt: number } | { ok: false; reason: 'not_found' | 'conflict' };

/** Credit plans, one JSON document per row, always scoped to the owning user. */
export function createPlanStore(db: SqlDatabase) {
  return {
    async listPlans(userId: string): Promise<PlanSummary[]> {
      const { results } = await db
        .prepare(`select id, name, client, created_at, updated_at from credit_plan where user_id = ? order by updated_at desc`)
        .bind(userId)
        .all<{ id: string; name: string; client: string | null; created_at: number; updated_at: number }>();
      return results.map((r) => ({ id: r.id, name: r.name, client: r.client, createdAt: r.created_at, updatedAt: r.updated_at }));
    },

    async countPlans(userId: string): Promise<number> {
      const r = await db.prepare(`select count(*) as n from credit_plan where user_id = ?`).bind(userId).first<{ n: number }>();
      return r?.n ?? 0;
    },

    async getPlan(userId: string, id: string): Promise<{ plan: CreditPlan; createdAt: number; updatedAt: number } | null> {
      const r = await db
        .prepare(`select doc, created_at, updated_at from credit_plan where user_id = ? and id = ?`)
        .bind(userId, id)
        .first<{ doc: string; created_at: number; updated_at: number }>();
      return r ? { plan: JSON.parse(r.doc) as CreditPlan, createdAt: r.created_at, updatedAt: r.updated_at } : null;
    },

    async createPlan(userId: string, id: string, plan: CreditPlan, at = Date.now()): Promise<void> {
      await db
        .prepare(`insert into credit_plan (id, user_id, name, client, doc, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, userId, plan.name, plan.client ?? null, JSON.stringify(plan), at, at)
        .run();
    },

    /**
     * Saves over the version the caller last read. If someone saved since (another tab or
     * device), nothing changes and the caller is told, rather than silently losing their edits.
     */
    async updatePlan(userId: string, id: string, plan: CreditPlan, baseUpdatedAt: number, now = Date.now()): Promise<PlanUpdate> {
      // Strictly increasing, so two saves in the same millisecond still look different.
      const at = Math.max(now, baseUpdatedAt + 1);
      const { meta } = await db
        .prepare(`update credit_plan set name = ?, client = ?, doc = ?, updated_at = ? where user_id = ? and id = ? and updated_at = ?`)
        .bind(plan.name, plan.client ?? null, JSON.stringify(plan), at, userId, id, baseUpdatedAt)
        .run();
      if (meta.changes > 0) return { ok: true, updatedAt: at };
      const exists = await db.prepare(`select 1 as x from credit_plan where user_id = ? and id = ?`).bind(userId, id).first();
      return { ok: false, reason: exists ? 'conflict' : 'not_found' };
    },

    async deletePlan(userId: string, id: string): Promise<boolean> {
      return (await db.prepare(`delete from credit_plan where user_id = ? and id = ?`).bind(userId, id).run()).meta.changes > 0;
    },
  };
}
