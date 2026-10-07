// Credit estimates for Data 360 work. A plan lists activities (ingestion, unification, segment
// refreshes...) in units a consultant can reason about; a rate card maps each activity to a billed
// usage type and multiplier. The same plan can be priced under either card, which is the point:
// clients move from Data Services credits to Flex Credits, and the activities don't change.
//
// Sources, transcribed as published (check the date before relying on them):
// - Flex Credits Rate Card, updated June 17, 2026. Data 360 multipliers are tiered per usage type
//   on credits consumed in the calendar month; sandbox is flat with no tiers.
// - Salesforce Customer Data Cloud Rate Card (Data Services credits), updated August 2025.
// - Activity → Flex usage type mapping: Trailhead, "Maximize Your Data 360 Credits".
// - A run that crosses a tier is billed entirely at the lower multiplier (same Trailhead unit).

export type Env = 'production' | 'sandbox';
export type Unit = 'rows' | 'events' | 'inferences' | 'mb' | 'gb' | 'compute';

export type ActivityKind =
  | 'ingest_internal'
  | 'ingest_batch'
  | 'ingest_streaming'
  | 'federation_in'
  | 'transform_batch'
  | 'transform_streaming'
  | 'unification'
  | 'ci_batch'
  | 'ci_streaming'
  | 'segmentation'
  | 'activation_batch'
  | 'activation_streaming'
  | 'streaming_actions'
  | 'queries'
  | 'sharing_out'
  | 'data_share_out'
  | 'real_time'
  | 'unstructured'
  | 'intelligent_processing'
  | 'inferences'
  | 'private_connect'
  | 'code_extension';

export interface ActivityDef {
  kind: ActivityKind;
  label: string;
  group: string;
  unit: Unit;
  /** A continuous flow (streaming): volume is entered per day rather than per run. */
  continuous?: boolean;
  hint: string;
}

export const ACTIVITIES: ActivityDef[] = [
  { kind: 'ingest_internal', group: 'Connect', unit: 'rows', label: 'Ingestion from Salesforce apps', hint: 'CRM, Marketing Cloud, Commerce and Personalization connectors. Native Salesforce connectors use no credits.' },
  { kind: 'ingest_batch', group: 'Connect', unit: 'rows', label: 'Batch ingestion from external sources', hint: 'Cloud storage, Ingestion API bulk, other external connectors. Rows processed per refresh: the whole file for a full refresh, the changes for an upsert.' },
  { kind: 'ingest_streaming', group: 'Connect', unit: 'rows', continuous: true, label: 'Streaming ingestion', hint: 'Web and Mobile SDK, Ingestion API streaming. Enter rows per day.' },
  { kind: 'federation_in', group: 'Connect', unit: 'rows', label: 'Zero-copy federation in', hint: 'Rows read from Snowflake, Databricks, BigQuery and similar without copying them in.' },
  { kind: 'transform_batch', group: 'Prepare & unify', unit: 'rows', label: 'Batch data transforms', hint: 'Rows read by each transform run.' },
  { kind: 'transform_streaming', group: 'Prepare & unify', unit: 'rows', continuous: true, label: 'Streaming data transforms', hint: 'Enter rows per day.' },
  { kind: 'unification', group: 'Prepare & unify', unit: 'rows', label: 'Identity resolution', hint: 'Source profiles processed by a ruleset. The first run counts every source profile (put it under One-time); later runs count only new or changed ones.' },
  { kind: 'ci_batch', group: 'Analyze', unit: 'rows', label: 'Batch calculated insights', hint: 'Rows read by each run; every refresh reads them again.' },
  { kind: 'ci_streaming', group: 'Analyze', unit: 'rows', continuous: true, label: 'Streaming calculated insights', hint: 'Enter rows per day.' },
  { kind: 'segmentation', group: 'Segment & activate', unit: 'rows', label: 'Segment refreshes', hint: 'Rows read from every object the segment uses, not its member count. Every refresh reads them again.' },
  { kind: 'activation_batch', group: 'Segment & activate', unit: 'rows', label: 'Batch activations', hint: 'Rows activated per run (members, plus related attributes).' },
  { kind: 'activation_streaming', group: 'Segment & activate', unit: 'rows', continuous: true, label: 'Streaming activations', hint: 'Activate DMO, streaming. Enter rows per day.' },
  { kind: 'streaming_actions', group: 'Act & real time', unit: 'rows', continuous: true, label: 'Data actions and lookups', hint: 'Streaming data actions, including lookups. Enter rows per day.' },
  { kind: 'queries', group: 'Act & real time', unit: 'rows', label: 'Queries', hint: 'Rows scanned (not returned) by Query API, reports, Tableau and this workbench.' },
  { kind: 'real_time', group: 'Act & real time', unit: 'events', continuous: true, label: 'Real-time events, API calls and actions', hint: 'Sub-second real-time: profile and entity events, API calls and actions. Enter events per day.' },
  { kind: 'sharing_out', group: 'Share', unit: 'rows', label: 'Zero-copy sharing out', hint: 'Rows an external platform reads through a data share.' },
  { kind: 'data_share_out', group: 'Share', unit: 'rows', label: 'Data share rows shared', hint: 'Rows shared out when a data share refreshes (a Data Services usage type).' },
  { kind: 'unstructured', group: 'Unstructured & AI', unit: 'mb', label: 'Unstructured data processed', hint: 'Megabytes of documents, transcripts and similar processed.' },
  { kind: 'intelligent_processing', group: 'Unstructured & AI', unit: 'mb', label: 'Intelligent processing', hint: 'Megabytes processed.' },
  { kind: 'inferences', group: 'Unstructured & AI', unit: 'inferences', label: 'Model inferences', hint: 'Predictions scored.' },
  { kind: 'private_connect', group: 'Other', unit: 'gb', label: 'Private Connect data processed', hint: 'Gigabytes through Private Connect.' },
  { kind: 'code_extension', group: 'Other', unit: 'compute', label: 'Code extension compute', hint: 'Compute units used by code extensions.' },
];

export const ACTIVITY = Object.fromEntries(ACTIVITIES.map((a) => [a.kind, a])) as Record<ActivityKind, ActivityDef>;

/** How many units one multiplier applies to: per 1M rows, events or inferences; per MB, GB or compute unit. */
export const UNIT_SIZE: Record<Unit, number> = { rows: 1e6, events: 1e6, inferences: 1e6, mb: 1, gb: 1, compute: 1 };
export const UNIT_NAME: Record<Unit, string> = { rows: 'rows', events: 'events', inferences: 'inferences', mb: 'MB', gb: 'GB', compute: 'compute units' };

export interface UsageType {
  id: string;
  label: string;
  unit: Unit;
  /** One flat multiplier, or one per tier (lowest credits first). */
  production: number[];
  sandbox: number;
}

export interface Mapping {
  usageType?: string;
  /** Not billed under this card (no usage type), as opposed to not priced by it. */
  free?: boolean;
  note?: string;
}

export type RateCardId = 'flex-2026-06' | 'data-services-2025-08';

export interface RateCard {
  id: RateCardId;
  name: string;
  /** What the contract calls the credits. */
  credits: string;
  asOf: string;
  source: string;
  /** Monthly tier thresholds in credits, per usage type. Absent for flat cards. */
  tiers?: number[];
  /** Whether sandbox usage draws on the same credits as production. */
  sandboxPool: 'shared' | 'separate';
  /** List price per 100,000 credits, if Salesforce publishes one. */
  listPricePer100k?: number;
  usageTypes: Record<string, UsageType>;
  map: Record<ActivityKind, Mapping>;
}

const ut = (id: string, label: string, unit: Unit, production: number[], sandbox: number): UsageType => ({ id, label, unit, production, sandbox });
const byId = (list: UsageType[]) => Object.fromEntries(list.map((u) => [u.id, u]));

export const FLEX_2026_06: RateCard = {
  id: 'flex-2026-06',
  name: 'Flex Credits (June 2026)',
  credits: 'Flex Credits',
  asOf: '2026-06-17',
  source: 'https://www.salesforce.com/en-us/wp-content/uploads/sites/4/assets/pdf/agentforce/Flex-Credits-Rate-Card-06.17.2026.pdf',
  tiers: [300_000, 1_500_000, 12_500_000],
  sandboxPool: 'shared',
  listPricePer100k: 500,
  usageTypes: byId([
    ut('prep', 'Data 360 Prep', 'rows', [40, 32, 16, 8], 32),
    ut('unification', 'Data 360 Unification', 'rows', [75_000, 60_000, 30_000, 15_000], 60_000),
    ut('segmentation', 'Data 360 Segmentation', 'rows', [50, 40, 20, 10], 40),
    ut('activation', 'Data 360 Activation', 'rows', [60, 48, 24, 12], 48),
    ut('sharing_out', 'Data 360 Zero-Copy Sharing-Out', 'rows', [60, 48, 24, 12], 48),
    ut('queries', 'Data 360 Queries', 'rows', [3, 2.4, 1.2, 0.6], 2.4),
    ut('unstructured', 'Data 360 Unstructured Processing', 'mb', [150, 120, 60, 30], 120),
    ut('intelligent', 'Data 360 Intelligent Processing', 'mb', [600, 480, 240, 120], 480),
    ut('streaming_pipeline', 'Data 360 Streaming Pipeline', 'rows', [3_500, 2_800, 1_400, 700], 2_800),
    ut('realtime', 'Data 360 Real-Time Pipeline', 'events', [250_000, 200_000, 100_000, 50_000], 200_000),
    ut('code_extension', 'Data 360 Code Extension', 'compute', [40, 32, 16, 8], 32),
  ]),
  map: {
    ingest_internal: { free: true, note: 'Native Salesforce connectors use no credits.' },
    ingest_batch: { free: true, note: 'No Flex usage type for batch ingestion (Salesforce maps it to “Not applicable”).' },
    ingest_streaming: { usageType: 'streaming_pipeline' },
    federation_in: { free: true, note: 'No Flex usage type for data federation; queries, segments and insights that read federated data bill in their own usage types.' },
    transform_batch: { usageType: 'prep' },
    transform_streaming: { usageType: 'streaming_pipeline' },
    unification: { usageType: 'unification' },
    ci_batch: { usageType: 'prep' },
    ci_streaming: { usageType: 'streaming_pipeline' },
    segmentation: { usageType: 'segmentation' },
    activation_batch: { usageType: 'activation' },
    activation_streaming: { usageType: 'activation', note: 'Assumed: Salesforce’s mapping lists batch activations only.' },
    streaming_actions: { usageType: 'streaming_pipeline' },
    queries: { usageType: 'queries' },
    sharing_out: { usageType: 'sharing_out' },
    data_share_out: { free: true, note: 'No Flex usage type for rows shared (Salesforce maps it to “Not applicable”); reads by the other platform bill as Zero-Copy Sharing-Out.' },
    real_time: { usageType: 'realtime' },
    unstructured: { usageType: 'unstructured' },
    intelligent_processing: { usageType: 'intelligent' },
    inferences: { note: 'Not on the Flex Data 360 card (Salesforce maps it to “Not applicable”). Ask the account team how it bills.' },
    private_connect: { note: 'Not on the Flex Data 360 card (Salesforce maps it to “Not applicable”). Ask the account team how it bills.' },
    code_extension: { usageType: 'code_extension' },
  },
};

export const DATA_SERVICES_2025_08: RateCard = {
  id: 'data-services-2025-08',
  name: 'Data Services credits (August 2025)',
  credits: 'Data Services credits',
  asOf: '2025-08',
  source: 'https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/platform/data-cloud-platform-services-rate-sheet-dc-9-04.pdf',
  sandboxPool: 'separate',
  usageTypes: byId([
    ut('internal', 'Internal Data Pipeline', 'rows', [0], 0),
    ut('pipeline_batch', '(External) Data Pipeline, batch', 'rows', [2_000], 1_600),
    ut('pipeline_streaming', '(External) Data Pipeline, streaming', 'rows', [5_000], 4_000),
    ut('transforms_batch', 'Data Transforms, batch', 'rows', [400], 320),
    ut('transforms_streaming', 'Data Transforms, streaming', 'rows', [5_000], 4_000),
    ut('unstructured', 'Unstructured Data Processed', 'mb', [60], 48),
    ut('federation', 'Data Federation or Sharing Rows Accessed', 'rows', [70], 56),
    ut('data_share', 'Data Share Rows Shared (Data Out)', 'rows', [800], 640),
    ut('private_connect', 'Private Connect Data Processed', 'gb', [500], 400),
    ut('unification', 'Profile Unification', 'rows', [100_000], 80_000),
    ut('realtime', 'Sub-second Real-Time Events', 'events', [70_000], 56_000),
    ut('ci_batch', 'Calculated Insights, batch', 'rows', [15], 12),
    ut('ci_streaming', 'Calculated Insights, streaming', 'rows', [800], 640),
    ut('inferences', 'Inferences', 'inferences', [3_500], 2_800),
    ut('queries', 'Data Queries', 'rows', [2], 1.6),
    ut('streaming_actions', 'Streaming Actions (including Lookups)', 'rows', [800], 640),
    ut('segmentation', 'Segment Rows Processed', 'rows', [20], 16),
    ut('activation_batch', 'Batch Activation', 'rows', [10], 8),
    ut('activation_streaming', 'Activate DMO, streaming', 'rows', [1_600], 1_280),
  ]),
  map: {
    ingest_internal: { usageType: 'internal' },
    ingest_batch: { usageType: 'pipeline_batch' },
    ingest_streaming: { usageType: 'pipeline_streaming' },
    federation_in: { usageType: 'federation' },
    transform_batch: { usageType: 'transforms_batch' },
    transform_streaming: { usageType: 'transforms_streaming' },
    unification: { usageType: 'unification' },
    ci_batch: { usageType: 'ci_batch' },
    ci_streaming: { usageType: 'ci_streaming' },
    segmentation: { usageType: 'segmentation' },
    activation_batch: { usageType: 'activation_batch' },
    activation_streaming: { usageType: 'activation_streaming' },
    streaming_actions: { usageType: 'streaming_actions' },
    queries: { usageType: 'queries' },
    sharing_out: { usageType: 'federation' },
    data_share_out: { usageType: 'data_share' },
    real_time: { usageType: 'realtime' },
    unstructured: { usageType: 'unstructured' },
    intelligent_processing: { note: 'Not on the August 2025 Data Services card. Ask the account team how it bills.' },
    inferences: { usageType: 'inferences' },
    private_connect: { usageType: 'private_connect' },
    code_extension: { note: 'Not on the August 2025 Data Services card. Ask the account team how it bills.' },
  },
};

export const RATE_CARDS: Record<RateCardId, RateCard> = {
  'flex-2026-06': FLEX_2026_06,
  'data-services-2025-08': DATA_SERVICES_2025_08,
};

// ------------------------------------------------------------------- plans

const AVG_DAYS = 365 / 12;

export const FREQUENCIES: { id: string; label: string; runs: number }[] = [
  { id: 'none', label: 'One-time only', runs: 0 },
  { id: 'monthly', label: 'Monthly', runs: 1 },
  { id: 'weekly', label: 'Weekly', runs: 52 / 12 },
  { id: 'daily', label: 'Daily', runs: AVG_DAYS },
  { id: '12h', label: 'Every 12 hours', runs: AVG_DAYS * 2 },
  { id: '6h', label: 'Every 6 hours', runs: AVG_DAYS * 4 },
  { id: '4h', label: 'Every 4 hours', runs: AVG_DAYS * 6 },
  { id: '1h', label: 'Hourly', runs: AVG_DAYS * 24 },
  { id: '15m', label: 'Every 15 minutes', runs: AVG_DAYS * 96 },
];
export const DAILY = AVG_DAYS;

const HOUR_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, SIX: 6, EIGHT: 8, TWELVE: 12, TWENTY_FOUR: 24 };

/**
 * Runs per month for a schedule as the API spells it: an insight's `publishScheduleInterval`
 * (ONE, SIX, TWELVE, TWENTY_FOUR hours; NOT_SCHEDULED), a segment's `publishInterval` (DAILY...),
 * a stream's refresh frequency (HOURLY, DAILY...). `known` is false when it can't tell; `manual`
 * when the API says the thing isn't scheduled.
 */
export function scheduleRuns(schedule: string | undefined): { runs: number; known: boolean; manual?: boolean } {
  const t = (schedule ?? '').trim().toUpperCase();
  if (/NOT_SCHEDULED|^NONE$|MANUAL|ON_DEMAND/.test(t)) return { runs: 0, known: true, manual: true };
  if (/15/.test(t) && /MIN/.test(t)) return { runs: AVG_DAYS * 96, known: true };
  if (/HOURLY/.test(t)) return { runs: AVG_DAYS * 24, known: true };
  const hours = HOUR_WORDS[t.replace(/_?HOURS?$/, '')] ?? (/^(\d+)(_?HOURS?)?$/.test(t) ? Number(/^\d+/.exec(t)![0]) : undefined);
  if (hours) return { runs: (AVG_DAYS * 24) / hours, known: true };
  if (/DAILY|DAY/.test(t)) return { runs: AVG_DAYS, known: true };
  if (/WEEK/.test(t)) return { runs: 52 / 12, known: true };
  if (/MONTH/.test(t)) return { runs: 1, known: true };
  return { runs: AVG_DAYS, known: false };
}

/** The preset matching a run rate, if any (rates are compared loosely: they come back from JSON). */
export function frequencyOf(runsPerMonth: number): { id: string; label: string; runs: number } | undefined {
  return FREQUENCIES.find((f) => Math.abs(f.runs - runsPerMonth) < 1e-6 * Math.max(1, f.runs));
}

export interface PlanItem {
  id: string;
  kind: ActivityKind;
  label: string;
  /** Units each run processes (rows, events, MB...). For continuous activities, units per day. */
  perRun: number;
  /** Runs per (average) month. Continuous activities run daily. */
  runsPerMonth: number;
  /** One-time units in the start month: a historical backfill, a first full unification run. */
  initial: number;
  /** First month of the plan this runs in (1-based). */
  startMonth: number;
  /** Last month it runs in (inclusive); absent means to the end of the plan. */
  endMonth?: number;
  env: Env;
  /** Why the numbers are what they are. Exported with the estimate. */
  assumption?: string;
  /** What in the org this was seeded from. */
  source?: string;
}

export interface Actual {
  /** Month of the plan (1-based). */
  month: number;
  credits: number;
}

export interface CreditPlan {
  version: 1;
  name: string;
  client?: string;
  cardId: RateCardId;
  /** Negotiated or updated production multipliers, per usage type; replaces that type's tiers. */
  overrides?: Record<string, number>;
  /** First month of the contract, YYYY-MM. Labels months; optional. */
  start?: string;
  /** Plan length in months. */
  months: number;
  /** Credits in the contract for the plan's term. */
  entitlement?: number;
  pricePer100k?: number;
  currency?: string;
  /** Annual growth of recurring volumes, in percent. One-time volumes don't grow. */
  growthPct: number;
  items: PlanItem[];
  /** Credits actually consumed (from Digital Wallet), by month. */
  actuals: Actual[];
  notes?: string;
}

export const MAX_MONTHS = 60;

export function newPlan(name: string, cardId: RateCardId = 'flex-2026-06'): CreditPlan {
  return { version: 1, name, cardId, months: 12, growthPct: 0, items: [], actuals: [] };
}

export function newItem(kind: ActivityKind, id: string, over: Partial<PlanItem> = {}): PlanItem {
  const a = ACTIVITY[kind];
  return {
    id,
    kind,
    label: a.label,
    perRun: 0,
    runsPerMonth: a.continuous ? DAILY : kind === 'unification' ? DAILY : 1,
    initial: 0,
    startMonth: 1,
    env: 'production',
    ...over,
  };
}

/** "Mar 2026" for month 3 of a plan starting 2026-01; "Month 3" without a start. */
export function monthLabel(plan: Pick<CreditPlan, 'start'>, month: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(plan.start ?? '');
  if (!m) return `Month ${month}`;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + month - 1, 1));
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Accepts "5m", "2.5k", "1.2b", "1,200,000" and plain numbers. */
export function parseQuantity(text: string): number | null {
  const m = /^\s*([0-9][0-9,]*(?:\.[0-9]+)?|\.[0-9]+)\s*([kmb])?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  const v = n * mult;
  return Number.isFinite(v) ? v : null;
}

// --------------------------------------------------------------- estimating

export interface ItemEstimate {
  id: string;
  usageType: string | null;
  /** Credits per month of the plan. */
  monthly: number[];
  total: number;
  /** Units over the plan (after growth). */
  units: number;
  /** Not billed under this card. */
  free: boolean;
  /** The card has no price for this activity, so it counts as 0 here. */
  unpriced: boolean;
  note?: string;
}

export interface UsageEstimate {
  id: string;
  label: string;
  unit: Unit;
  env: Env;
  monthly: number[];
  units: number;
  total: number;
  /** Highest tier reached in each month (0 = base), for tiered production usage. */
  tier: number[];
}

export interface MonthEstimate {
  month: number;
  label: string;
  production: number;
  sandbox: number;
  /** What draws on the entitlement: production, plus sandbox when the card pools them. */
  pooled: number;
  actual: number | null;
  /** Pooled credits to date, using the actual where one was entered. */
  cumulative: number;
  remaining: number | null;
}

export interface Estimate {
  cardId: RateCardId;
  months: MonthEstimate[];
  items: ItemEstimate[];
  usage: UsageEstimate[];
  total: { production: number; sandbox: number; pooled: number };
  /** Pooled credits for the term at the plan's price; null without a price. */
  cost: number | null;
  /** First month in which cumulative consumption exceeds the entitlement. */
  exhaustedMonth: number | null;
  warnings: string[];
}

interface Run {
  t: number;
  order: number;
  item: number;
  units: number;
}

/** Runs are grouped beyond this many per item-month; finer detail doesn't change tiers. */
const MAX_RUNS = 100;

function runsInMonth(item: PlanItem, index: number, month: number, growth: number): Run[] {
  if (month + 1 < item.startMonth || (item.endMonth !== undefined && month + 1 > item.endMonth)) return [];
  const out: Run[] = [];
  if (month + 1 === item.startMonth && item.initial > 0) out.push({ t: 0, order: index, item: index, units: item.initial });
  const n = item.runsPerMonth;
  const per = item.perRun * growth;
  if (!(n > 0) || !(per > 0)) return out;
  const full = Math.floor(n);
  const step = Math.max(1, Math.ceil(full / MAX_RUNS));
  for (let k = 0; k < full; k += step) {
    const m = Math.min(step, full - k);
    out.push({ t: (k + m / 2) / n, order: index, item: index, units: per * m });
  }
  const frac = n - full;
  if (frac > 1e-9) out.push({ t: (full + frac / 2) / n, order: index, item: index, units: per * frac });
  return out;
}

/** Tier of the next credit after `used` credits this month. */
const tierAt = (tiers: number[], used: number) => tiers.filter((t) => used >= t).length;
/** Tier of the last credit when `used` credits have been consumed (thresholds are inclusive). */
const tierOfLast = (tiers: number[], used: number) => tiers.filter((t) => used > t).length;

/**
 * Credits for one run of `x` billing units after `used` credits this month. A run that would end
 * in a higher tier than it starts in is billed entirely at that tier's (lower) multiplier.
 */
export function chargeRun(x: number, used: number, multipliers: number[], tiers: number[] | undefined): { credits: number; tier: number } {
  if (!tiers || multipliers.length === 1) return { credits: x * multipliers[0]!, tier: 0 };
  const t0 = Math.min(tierAt(tiers, used), multipliers.length - 1);
  const c0 = x * multipliers[t0]!;
  const t1 = Math.min(tierOfLast(tiers, used + c0), multipliers.length - 1);
  return t1 > t0 ? { credits: x * multipliers[t1]!, tier: t1 } : { credits: c0, tier: t0 };
}

export function estimate(plan: CreditPlan, card: RateCard = RATE_CARDS[plan.cardId]): Estimate {
  const months = Math.max(1, Math.min(MAX_MONTHS, Math.floor(plan.months)));
  const zeros = () => new Array<number>(months).fill(0);
  const warnings: string[] = [];
  const items: ItemEstimate[] = plan.items.map((it) => {
    const m = card.map[it.kind];
    return {
      id: it.id,
      usageType: m.usageType ?? null,
      monthly: zeros(),
      total: 0,
      units: 0,
      free: Boolean(m.free),
      unpriced: !m.usageType && !m.free,
      ...(m.note ? { note: m.note } : {}),
    };
  });
  const usage = new Map<string, UsageEstimate>();
  const usageFor = (id: string, env: Env): UsageEstimate => {
    const key = `${env}:${id}`;
    let u = usage.get(key);
    if (!u) {
      const t = card.usageTypes[id]!;
      u = { id, label: t.label, unit: t.unit, env, monthly: zeros(), units: 0, total: 0, tier: zeros() };
      usage.set(key, u);
    }
    return u;
  };
  const multipliers = (id: string, env: Env): { mult: number[]; tiers?: number[] } => {
    const t = card.usageTypes[id]!;
    if (env === 'sandbox') return { mult: [t.sandbox] };
    const o = plan.overrides?.[id];
    if (o !== undefined && Number.isFinite(o) && o >= 0) return { mult: [o] };
    return { mult: t.production, ...(card.tiers && t.production.length > 1 ? { tiers: card.tiers } : {}) };
  };

  for (let month = 0; month < months; month++) {
    const growth = (1 + plan.growthPct / 100) ** (month / 12);
    // Group this month's runs by billed usage type and environment, in time order.
    const groups = new Map<string, Run[]>();
    plan.items.forEach((it, i) => {
      const runs = runsInMonth(it, i, month, growth);
      for (const r of runs) items[i]!.units += r.units;
      const id = items[i]!.usageType;
      if (!id || !runs.length) return;
      const key = `${it.env}:${id}`;
      groups.set(key, [...(groups.get(key) ?? []), ...runs]);
    });
    for (const [key, runs] of groups) {
      const [env, id] = key.split(':') as [Env, string];
      const u = usageFor(id, env);
      const { mult, tiers } = multipliers(id, env);
      const size = UNIT_SIZE[u.unit];
      runs.sort((a, b) => a.t - b.t || a.order - b.order);
      let used = 0;
      let top = 0;
      for (const r of runs) {
        const { credits, tier } = chargeRun(r.units / size, used, mult, tiers);
        used += credits;
        top = Math.max(top, tier);
        items[r.item]!.monthly[month]! += credits;
        u.units += r.units;
      }
      u.monthly[month] = used;
      u.tier[month] = top;
    }
  }

  for (const it of items) it.total = it.monthly.reduce((a, b) => a + b, 0);
  for (const u of usage.values()) u.total = u.monthly.reduce((a, b) => a + b, 0);

  plan.items.forEach((it, i) => {
    const e = items[i]!;
    if (e.unpriced && (it.perRun > 0 || it.initial > 0)) warnings.push(`${it.label}: ${e.note ?? 'not priced on this card'} Counted as 0 credits.`);
  });
  if (plan.items.some((it) => it.env === 'sandbox') && card.sandboxPool === 'separate') {
    warnings.push(`Sandbox usage draws on separate ${card.credits} for Sandbox, so it is shown apart and not counted against the entitlement.`);
  }

  const actual = new Map(plan.actuals.map((a) => [a.month, a.credits]));
  let cumulative = 0;
  let exhaustedMonth: number | null = null;
  const monthRows: MonthEstimate[] = [];
  for (let month = 0; month < months; month++) {
    let production = 0;
    let sandbox = 0;
    for (const u of usage.values()) {
      if (u.env === 'production') production += u.monthly[month]!;
      else sandbox += u.monthly[month]!;
    }
    const pooled = production + (card.sandboxPool === 'shared' ? sandbox : 0);
    const a = actual.get(month + 1);
    cumulative += a ?? pooled;
    const remaining = plan.entitlement !== undefined ? plan.entitlement - cumulative : null;
    if (remaining !== null && remaining < 0 && exhaustedMonth === null) exhaustedMonth = month + 1;
    monthRows.push({ month: month + 1, label: monthLabel(plan, month + 1), production, sandbox, pooled, actual: a ?? null, cumulative, remaining });
  }

  const total = monthRows.reduce(
    (t, m) => ({ production: t.production + m.production, sandbox: t.sandbox + m.sandbox, pooled: t.pooled + m.pooled }),
    { production: 0, sandbox: 0, pooled: 0 },
  );
  const order = new Map(Object.keys(card.usageTypes).map((k, i) => [k, i]));
  return {
    cardId: card.id,
    months: monthRows,
    items,
    usage: [...usage.values()].sort((a, b) => a.env.localeCompare(b.env) || order.get(a.id)! - order.get(b.id)!),
    total,
    cost: plan.pricePer100k !== undefined ? (total.pooled / 100_000) * plan.pricePer100k : null,
    exhaustedMonth,
    warnings,
  };
}

// ------------------------------------------------------------------ levers

export interface Lever {
  itemId: string;
  title: string;
  detail: string;
  patch: Partial<PlanItem>;
  /** Pooled credits saved over the plan, recomputed with the change applied. */
  saves: number;
}

const TO_BATCH: Partial<Record<ActivityKind, ActivityKind>> = {
  ingest_streaming: 'ingest_batch',
  transform_streaming: 'transform_batch',
  ci_streaming: 'ci_batch',
  activation_streaming: 'activation_batch',
};
/** Activities that read their whole input on every run, so credits scale with frequency. */
const RESCANS = new Set<ActivityKind>(['segmentation', 'ci_batch', 'activation_batch']);

/**
 * Changes that would cut the estimate, each priced by re-running it. Largest saving first. Only
 * the `limit` costliest candidates are tried: each try is a full estimate, and a small activity
 * can't save much.
 */
export function levers(plan: CreditPlan, card: RateCard = RATE_CARDS[plan.cardId], base = estimate(plan, card), limit = 12): Lever[] {
  const out: Lever[] = [];
  const cost = new Map(base.items.map((e) => [e.id, e.total]));
  const candidates = plan.items
    .filter((it) => TO_BATCH[it.kind] || (RESCANS.has(it.kind) && it.runsPerMonth > DAILY * 1.0001))
    .sort((a, b) => (cost.get(b.id) ?? 0) - (cost.get(a.id) ?? 0))
    .slice(0, limit);
  const priced = (itemId: string, patch: Partial<PlanItem>) => {
    const next = { ...plan, items: plan.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) };
    return base.total.pooled - estimate(next, card).total.pooled;
  };
  for (const it of candidates) {
    const batch = TO_BATCH[it.kind];
    if (batch) {
      const patch = { kind: batch, runsPerMonth: DAILY };
      const saves = priced(it.id, patch);
      if (saves > 0.5) {
        out.push({
          itemId: it.id,
          title: `Run “${it.label}” as a daily batch`,
          detail: `If the use case can wait a day. Same daily volume, billed as ${ACTIVITY[batch].label.toLowerCase()}.`,
          patch,
          saves,
        });
      }
    }
    if (RESCANS.has(it.kind) && it.runsPerMonth > DAILY * 1.0001) {
      const patch = { runsPerMonth: DAILY };
      const saves = priced(it.id, patch);
      if (saves > 0.5) {
        out.push({
          itemId: it.id,
          title: `Refresh “${it.label}” daily instead of ${(frequencyOf(it.runsPerMonth)?.label ?? `${Math.round(it.runsPerMonth)} times a month`).toLowerCase()}`,
          detail: 'Every refresh reads the full input again, so credits scale with how often it runs.',
          patch,
          saves,
        });
      }
    }
  }
  return out.sort((a, b) => b.saves - a.saves);
}
