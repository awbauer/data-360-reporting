// What an org actually consumed, read from the consumption objects Salesforce provides with
// Digital Wallet. Source: Salesforce, "Build a Credit Feedback Loop for Data 360":
//
//   TenantDailyEntitlementConsumption__dll   credits per day per consumption card
//   TenantHourlyEntitlementConsumption__dll  credits per hour per resource (segment, insight...)
//   TenantEntitlementTransaction__dll        credits purchased per card
//   TenantBillingUsageEvent__dll / TenantEnrichedUsageEvent__dll   individual usage events
//
// The same data can be mapped to standard DMOs (Tenant Consumption Insights, Glb Tenant
// Entitlement Transaction...), whose fields carry a std__ prefix and different capitalization.
// So nothing here hard-codes a name: objects and fields are found in the org's own metadata and
// matched on a normalized name (unitsconsumed__c and std__UnitsConsumed__c are the same field).
import { fieldKey as normalizeField, objectKey as normalizeObject } from './dmo-names';
import { quoteIdent } from './sql';
import type { CellValue, FieldMeta, ObjectMeta } from './types';

export type SourceKind = 'daily' | 'hourly' | 'events' | 'entitlement';

export type Role =
  | 'date' | 'credits' | 'usage' | 'card' | 'usageType' | 'env' | 'resourceType' | 'resource' | 'rowDetail' | 'quantity';

/** Normalized field names for each role, most specific first. */
const ROLE_NAMES: Record<Role, string[]> = {
  date: ['utilizationdate', 'usagehourbucket', 'eventtime', 'usagedate', 'consumptiondate', 'transactiondate', 'effectivedate', 'startdate'],
  credits: ['unitsconsumed'],
  usage: ['usageconsumed', 'usagevalue'],
  card: ['carddefinitiondevelopername', 'carddefinitionname', 'carddevelopername'],
  usageType: ['usagetypedevelopername', 'usagetypecode', 'usagetype'],
  env: ['usagebusinessenvtype', 'businessenvtype'],
  resourceType: ['resourcetype', 'rootresourcetype'],
  resource: ['resourceidorapiname', 'rootresourceidorapiname'],
  rowDetail: ['rowdetail'],
  quantity: ['quantity'],
};

interface SourceDef {
  kind: SourceKind;
  label: string;
  /** Normalized object names, preferred first. */
  names: string[];
  /** Roles a source must have to be used. */
  needs: Role[];
}

const SOURCE_DEFS: SourceDef[] = [
  { kind: 'daily', label: 'Daily entitlement consumption', names: ['tenantdailyentitlementconsumption'], needs: ['date', 'credits'] },
  { kind: 'hourly', label: 'Hourly entitlement consumption', names: ['tenanthourlyentitlementconsumption'], needs: ['date', 'credits'] },
  {
    kind: 'events',
    label: 'Usage events',
    names: ['tenantconsumptioninsights', 'glbtenantconsumptioninsights', 'tenantenrichedusageevent', 'glbtenantenrichedusageevent', 'tenantbillingusageevent'],
    needs: ['date', 'credits'],
  },
  { kind: 'entitlement', label: 'Entitlement transactions', names: ['tenantentitlementtransaction', 'glbtenantentitlementtransaction'], needs: ['quantity'] },
];

/** One spelling-independent key per field and object; see dmo-names.ts. */
export { fieldKey as normalizeField, objectKey as normalizeObject } from './dmo-names';

export interface Source {
  kind: SourceKind;
  label: string;
  object: ObjectMeta;
  /** The org's field for each role it has. */
  fields: Partial<Record<Role, FieldMeta>>;
  /** Roles the data could answer with this source but doesn't have (for the "what's missing" note). */
  missing: Role[];
}

/** Every consumption object in the metadata, best candidate per kind first. */
export function findSources(objects: ObjectMeta[]): Source[] {
  const out: Source[] = [];
  for (const def of SOURCE_DEFS) {
    const found = objects
      .map((o) => ({ o, rank: def.names.indexOf(normalizeObject(o.name)) }))
      .filter((x) => x.rank >= 0)
      // Prefer the documented order, then data lake objects (the raw feed) over models of it.
      .sort((a, b) => a.rank - b.rank || (a.o.kind === 'dlo' ? -1 : 1) - (b.o.kind === 'dlo' ? -1 : 1));
    for (const { o } of found) {
      const byNorm = new Map(o.fields.map((f) => [normalizeField(f.name), f]));
      const fields: Source['fields'] = {};
      for (const role of Object.keys(ROLE_NAMES) as Role[]) {
        const hit = ROLE_NAMES[role].map((n) => byNorm.get(n)).find(Boolean);
        if (hit) fields[role] = hit;
      }
      const wanted: Role[] = def.kind === 'hourly' ? ['resourceType', 'resource', 'rowDetail'] : def.kind === 'entitlement' ? ['card'] : ['card', 'env'];
      out.push({ kind: def.kind, label: def.label, object: o, fields, missing: [...def.needs, ...wanted].filter((r) => !fields[r]) });
    }
  }
  return out;
}

const usable = (s: Source) => SOURCE_DEFS.find((d) => d.kind === s.kind)!.needs.every((r) => s.fields[r]);

export interface SourcePick {
  /** Daily totals: the daily object, else events or hourly rolled up. */
  totals?: Source;
  /** Per-resource consumption. */
  resources?: Source;
  entitlement?: Source;
}

export function pickSources(sources: Source[]): SourcePick {
  const ok = sources.filter(usable);
  const first = (...kinds: SourceKind[]) => kinds.map((k) => ok.find((s) => s.kind === k)).find(Boolean);
  return {
    totals: first('daily', 'events', 'hourly'),
    resources: ok.find((s) => s.kind === 'hourly' && s.fields.resource) ?? ok.find((s) => s.fields.resource),
    entitlement: first('entitlement'),
  };
}

// ------------------------------------------------------------------------- SQL

const q = quoteIdent;

/**
 * The date or time column as a value Hyper can compare and truncate. Salesforce's examples cast
 * these columns explicitly, so text columns are cast; typed ones are used as they are.
 */
function timeExpr(f: FieldMeta, as: 'DATE' | 'TIMESTAMP'): string {
  return /DATE|TIME/i.test(f.type) ? q(f.name) : `CAST(${q(f.name)} AS ${as})`;
}

/** Rows the hourly feed is still filling in are excluded, as Salesforce advises. */
const processedOnly = (s: Source) => (s.fields.rowDetail ? ` AND ${q(s.fields.rowDetail.name)} = 'PROCESSED'` : '');
const timeAs = (s: Source) => (s.kind === 'daily' ? 'DATE' : 'TIMESTAMP');

export interface BuiltQuery {
  sql: string;
  /** `:since` is a date parameter. */
  since: string;
}

/** Credits per month since `since` (YYYY-MM-DD), by card and environment when the source has them. */
export function monthlySql(s: Source, since: string): BuiltQuery {
  const t = timeExpr(s.fields.date!, timeAs(s));
  const dims = (['card', 'env'] as const).filter((r) => s.fields[r]);
  const select = [`DATE_TRUNC('month', ${t}) AS "month"`, ...dims.map((r) => `${q(s.fields[r]!.name)} AS "${r}"`), `SUM(${q(s.fields.credits!.name)}) AS "credits"`];
  return {
    since,
    sql:
      `SELECT ${select.join(', ')}\nFROM ${q(s.object.name)}\nWHERE ${t} >= :since${processedOnly(s)}\n` +
      `GROUP BY ${select.slice(0, 1 + dims.length).map((_, i) => i + 1).join(', ')}\nORDER BY 1`,
  };
}

/** Credits per day since `since`, all cards together. */
export function dailySql(s: Source, since: string): BuiltQuery {
  const t = timeExpr(s.fields.date!, timeAs(s));
  return {
    since,
    sql:
      `SELECT DATE_TRUNC('day', ${t}) AS "day", SUM(${q(s.fields.credits!.name)}) AS "credits"\nFROM ${q(s.object.name)}\n` +
      `WHERE ${t} >= :since${processedOnly(s)}\nGROUP BY 1\nORDER BY 1`,
  };
}

/** The resources that consumed most since `since`. */
export function resourcesSql(s: Source, since: string, limit = 500): BuiltQuery {
  const t = timeExpr(s.fields.date!, 'TIMESTAMP');
  const dims = (['resourceType', 'resource'] as const).filter((r) => s.fields[r]);
  const select = [...dims.map((r) => `${q(s.fields[r]!.name)} AS "${r}"`), `SUM(${q(s.fields.credits!.name)}) AS "credits"`];
  return {
    since,
    sql:
      `SELECT ${select.join(', ')}\nFROM ${q(s.object.name)}\nWHERE ${t} >= :since${processedOnly(s)}\n` +
      `GROUP BY ${dims.map((_, i) => i + 1).join(', ')}\nORDER BY "credits" DESC\nLIMIT ${Math.max(1, Math.floor(limit))}`,
  };
}

/** Credits purchased, by card when the source has one. */
export function entitlementSql(s: Source): { sql: string } {
  const card = s.fields.card ? `${q(s.fields.card.name)} AS "card", ` : '';
  return { sql: `SELECT ${card}SUM(${q(s.fields.quantity!.name)}) AS "credits"\nFROM ${q(s.object.name)}${card ? '\nGROUP BY 1' : ''}` };
}

// ---------------------------------------------------------------------- results

export interface MonthRow { month: string; card?: string; env?: string; credits: number }
export interface DayRow { day: string; credits: number }
export interface ResourceRow { resourceType?: string; resource: string; credits: number }
export interface EntitlementRow { card?: string; credits: number }

export interface Consumption {
  /** When it was read (ISO). */
  at: string;
  sources: { totals?: string; resources?: string; entitlement?: string };
  monthlySince: string;
  dailySince: string;
  resourcesSince: string;
  monthly: MonthRow[];
  daily: DayRow[];
  resources: ResourceRow[];
  entitlement: EntitlementRow[];
  /** Parts that couldn't be read, with Salesforce's message. */
  errors?: string[];
}

const num = (v: CellValue | undefined) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const text = (v: CellValue | undefined) => (v === null || v === undefined ? undefined : String(v));
/** Hyper returns dates as `2026-10-01` or timestamps with an offset; keep the calendar date. */
const ymd = (v: CellValue | undefined) => String(v ?? '').slice(0, 10);

/** Rows into named values, by the result's column names. */
function rowsBy(columns: { name: string }[], rows: CellValue[][]) {
  const idx = new Map(columns.map((c, i) => [c.name.toLowerCase(), i]));
  return rows.map((r) => (name: string) => {
    const i = idx.get(name.toLowerCase());
    return i === undefined ? undefined : r[i];
  });
}

export function parseMonthly(columns: { name: string }[], rows: CellValue[][]): MonthRow[] {
  return rowsBy(columns, rows).map((g) => ({
    month: ymd(g('month')).slice(0, 7),
    ...(text(g('card')) !== undefined ? { card: text(g('card'))! } : {}),
    ...(text(g('env')) !== undefined ? { env: text(g('env'))! } : {}),
    credits: num(g('credits')),
  }));
}

export function parseDaily(columns: { name: string }[], rows: CellValue[][]): DayRow[] {
  return rowsBy(columns, rows).map((g) => ({ day: ymd(g('day')), credits: num(g('credits')) }));
}

export function parseResources(columns: { name: string }[], rows: CellValue[][]): ResourceRow[] {
  return rowsBy(columns, rows).map((g) => ({
    ...(text(g('resourceType')) !== undefined ? { resourceType: text(g('resourceType'))! } : {}),
    resource: text(g('resource')) ?? '(unnamed)',
    credits: num(g('credits')),
  }));
}

export function parseEntitlement(columns: { name: string }[], rows: CellValue[][]): EntitlementRow[] {
  return rowsBy(columns, rows).map((g) => ({ ...(text(g('card')) !== undefined ? { card: text(g('card'))! } : {}), credits: num(g('credits')) }));
}

// ---------------------------------------------------------------------- summary

const DAY = 86_400_000;
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const isSandbox = (env?: string) => /sandbox|test|non.?prod/i.test(env ?? '');

export interface Summary {
  thisMonth: number;
  lastMonth: number;
  /** Trailing 30 complete days, and the daily average over them. */
  last30: number;
  dailyAverage: number;
  /** This month so far plus the daily average for the days left. */
  projectedMonth: number;
  /** Purchased minus consumed since `from` (or over all months read); null without entitlement data. */
  remaining: number | null;
  purchased: number | null;
  /** Consumed since `from`, or over all months read. */
  consumed: number;
  /** Days until `remaining` runs out at the daily average; null if it doesn't or can't be told. */
  runwayDays: number | null;
  byMonth: { month: string; production: number; sandbox: number }[];
  byCard: { card: string; credits: number }[];
}

/**
 * The headline figures, as of `now`. `cards` limits them to some consumption cards; `from` (YYYY-MM,
 * the contract start) is where "consumed" and "remaining" count from.
 */
export function summarize(c: Consumption, now = Date.now(), opts: { cards?: Set<string>; from?: string } = {}): Summary {
  const { cards, from: since } = opts;
  const keep = (card?: string) => !cards || cards.has(card ?? '');
  const monthly = c.monthly.filter((m) => keep(m.card));
  const thisMonthKey = isoDay(now).slice(0, 7);
  const d = new Date(now);
  const lastMonthKey = isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).slice(0, 7);
  const sum = (rows: MonthRow[]) => rows.reduce((t, r) => t + r.credits, 0);
  const thisMonth = sum(monthly.filter((m) => m.month === thisMonthKey));
  const lastMonth = sum(monthly.filter((m) => m.month === lastMonthKey));

  // The daily series covers every card; scale it to the chosen cards by their share this period.
  const today = isoDay(now);
  const from = isoDay(now - 30 * DAY);
  const last30All = c.daily.filter((r) => r.day >= from && r.day < today).reduce((t, r) => t + r.credits, 0);
  const allMonthly = sum(c.monthly);
  const share = cards && allMonthly > 0 ? sum(monthly) / allMonthly : 1;
  const last30 = last30All * share;
  const dailyAverage = last30 / 30;
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const projectedMonth = thisMonth + dailyAverage * (daysInMonth - d.getUTCDate() + 1);

  const ent = c.entitlement.filter((e) => keep(e.card));
  const purchased = c.sources.entitlement ? ent.reduce((t, e) => t + e.credits, 0) : null;
  const consumed = sum(since ? monthly.filter((m) => m.month >= since) : monthly);
  const remaining = purchased === null ? null : purchased - consumed;
  const runwayDays = remaining !== null && remaining > 0 && dailyAverage > 0 ? remaining / dailyAverage : null;

  const months = [...new Set(monthly.map((m) => m.month))].sort();
  const byCard = new Map<string, number>();
  for (const m of monthly) byCard.set(m.card ?? 'All', (byCard.get(m.card ?? 'All') ?? 0) + m.credits);
  return {
    thisMonth,
    lastMonth,
    last30,
    dailyAverage,
    projectedMonth,
    remaining,
    purchased,
    consumed,
    runwayDays,
    byMonth: months.map((month) => ({
      month,
      production: sum(monthly.filter((m) => m.month === month && !isSandbox(m.env))),
      sandbox: sum(monthly.filter((m) => m.month === month && isSandbox(m.env))),
    })),
    byCard: [...byCard].map(([card, credits]) => ({ card, credits })).sort((a, b) => b.credits - a.credits),
  };
}

/** Months of a plan (1-based) that have consumption, for a plan starting `start` (YYYY-MM). */
export function planActuals(c: Consumption, start: string, months: number, opts: { cards?: Set<string>; includeSandbox: boolean; through?: string }): { month: number; credits: number }[] {
  const [y, m] = start.split('-').map(Number) as [number, number];
  const out: { month: number; credits: number }[] = [];
  for (let i = 0; i < months; i++) {
    const key = isoDay(Date.UTC(y, m - 1 + i, 1)).slice(0, 7);
    if (opts.through && key > opts.through) break;
    const rows = c.monthly.filter((r) => r.month === key && (!opts.cards || opts.cards.has(r.card ?? '')) && (opts.includeSandbox || !isSandbox(r.env)));
    if (rows.length) out.push({ month: i + 1, credits: rows.reduce((t, r) => t + r.credits, 0) });
  }
  return out;
}

// ------------------------------------------------------------------- attribution

/** `Lapsed_VIPs`, `Avg_Spends__cio`, `Avg Spends` → `lapsedvips`, `avgspends`, `avgspends`. */
const key = (s: string) => s.toLowerCase().replace(/(_std)?__(dlm|dll|cio|c)$/, '').replace(/^(std|ssot)__/, '').replace(/[^a-z0-9]/g, '');

/**
 * Credits a named thing consumed, from the per-resource rows: matched on the resource name, or
 * any of `names` (API name, label, a stream that loads it), ignoring case and suffixes.
 */
export function attributedCredits(resources: ResourceRow[], names: string[]): { credits: number; matched: ResourceRow[] } {
  const want = new Set(names.filter(Boolean).map(key));
  const matched = resources.filter((r) => want.has(key(r.resource)));
  return { credits: matched.reduce((t, r) => t + r.credits, 0), matched };
}
