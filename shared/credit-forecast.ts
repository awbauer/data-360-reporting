// Credits for the common things done with one object, insight, segment or query: query it,
// refresh a segment over it, ingest it, change an insight's schedule. Each action is priced by
// estimating a one-activity plan, so tiers and rate-card mappings are the Credits page's exactly.
// Row volumes come from row counts the browser cached; with none, actions are priced per million.
import { classifyStream, objectsMentioned } from './credits-seed';
import { ACTIVITY, DAILY, estimate, newItem, newPlan, scheduleRuns, type ActivityKind, type PlanItem, type RateCard } from './credits';
import { objectKey } from './dmo-names';
import { describePublishInterval } from './schedule';
import type { InsightDefinition, ObjectMeta, SegmentInfo, StreamInfo } from './types';

export type Counts = Record<string, { rows: number; at: string }>;

export interface Action {
  id: string;
  label: string;
  /** Where the volume and frequency come from. */
  detail?: string;
  kind: ActivityKind;
  /** Units one run processes (per day for continuous activities). */
  units: number;
  /** 0 for a one-off. */
  runsPerMonth: number;
}

export interface ActionCost extends Action {
  /** Credits for one run, on its own at the start of a month. */
  once: number;
  /** Credits for a month at `runsPerMonth`, tiers included; null for a one-off. */
  monthly: number | null;
  usageType: string | null;
  free: boolean;
  unpriced: boolean;
  note?: string;
}

export interface Forecast {
  actions: ActionCost[];
  /** Rows read per run, or null when a row count is missing (actions are then per million rows). */
  rows: number | null;
  /** The objects read and their cached counts (null = not counted). */
  reads: { name: string; rows: number | null }[];
}

const PER = 1e6;
const n = (x: number) => Math.round(x).toLocaleString('en-US');

export function priceAction(card: RateCard, a: Action): ActionCost {
  const plan = (item: Partial<PlanItem>) => ({ ...newPlan('forecast', card.id), months: 1, items: [newItem(a.kind, 'a', item)] });
  const once = estimate(plan({ perRun: 0, runsPerMonth: 0, initial: a.units }), card);
  const e = once.items[0]!;
  return {
    ...a,
    once: once.total.pooled,
    monthly: a.runsPerMonth > 0 ? estimate(plan({ perRun: a.units, runsPerMonth: a.runsPerMonth, initial: 0 }), card).total.pooled : null,
    usageType: e.usageType,
    free: e.free,
    unpriced: e.unpriced,
    ...(e.note ? { note: e.note } : {}),
  };
}

/** Rows read by reading each of `names` once in full, from cached counts. */
export function sizeReads(names: string[], counts: Counts): { rows: number | null; reads: Forecast['reads'] } {
  const reads = names.map((name) => ({ name, rows: counts[name]?.rows ?? null }));
  return { rows: reads.length && reads.every((r) => r.rows !== null) ? reads.reduce((t, r) => t + r.rows!, 0) : null, reads };
}

const price = (card: RateCard, actions: Action[]) => actions.map((a) => priceAction(card, a));

/** Every N hours, as runs per month. */
const everyHours = (h: number) => (DAILY * 24) / h;
/** "every 24 hours", "daily": the API's schedule spellings in words (insight intervals are hours). */
const scheduleText = (s: string) => describePublishInterval(s);

/**
 * Objects identity resolution counts as source profiles: Individual and Account, in whichever
 * spelling the org has (ssot__Individual__dlm, a standard Individual_std__dlm...), not their
 * unified results or link objects.
 */
export function isSourceProfile(o: ObjectMeta): boolean {
  return o.kind === 'dmo' && ['individual', 'account'].includes(objectKey(o.name));
}

/** Common actions on a data model or data lake object. `streams` are the ones that load a DLO. */
export function objectForecast(card: RateCard, obj: ObjectMeta, counts: Counts, opts: { streams?: StreamInfo[]; changeRate?: number } = {}): Forecast {
  const counted = counts[obj.name]?.rows;
  const rows = counted ?? null;
  const R = rows ?? PER;
  const vol = rows === null ? 'per million rows' : `${n(R)} rows`;
  const a: Action[] = [
    { id: 'query', label: 'Query it in full, once', detail: `A count, a profile, or a report with no filter: scans ${vol}.`, kind: 'queries', units: R, runsPerMonth: 0 },
    { id: 'query-daily', label: 'The same query every day', detail: 'A scheduled report or dashboard over the whole object.', kind: 'queries', units: R, runsPerMonth: DAILY },
  ];
  if (obj.kind === 'dlo') {
    const s = opts.streams?.[0];
    if (s) {
      const c = classifyStream(s);
      const sch = scheduleRuns(s.refreshFrequency);
      const runs = c.kind === 'ingest_streaming' ? DAILY : sch.known && !sch.manual ? sch.runs : DAILY;
      const units = s.lastRunRecords ?? (c.kind === 'ingest_streaming' ? R / DAILY : R);
      a.push({
        id: 'stream',
        label: `Its data stream, ${s.label}`,
        detail: [
          c.kind === 'ingest_internal' ? 'A native Salesforce connector.' : c.kind === 'ingest_streaming' ? 'Streaming.' : 'External batch.',
          s.lastRunRecords !== undefined ? `Last run processed ${n(s.lastRunRecords)} rows.` : c.kind === 'ingest_streaming' ? 'Assumes the object’s rows arrive over a month.' : 'Assumes each refresh reloads every row.',
          sch.known && !sch.manual ? `Refreshes ${scheduleText(s.refreshFrequency!)}.` : c.kind === 'ingest_streaming' ? '' : 'Schedule unknown; assumed daily.',
        ].filter(Boolean).join(' '),
        kind: c.kind,
        units,
        runsPerMonth: runs,
      });
    }
    if (!s || classifyStream(s).kind !== 'ingest_batch') {
      a.push({ id: 'ingest-batch', label: 'Reloading it from an external source, daily', detail: `A full-refresh batch stream of ${vol}.`, kind: 'ingest_batch', units: R, runsPerMonth: DAILY });
    }
    if (!s || classifyStream(s).kind !== 'ingest_streaming') {
      a.push({ id: 'ingest-stream', label: 'The same rows arriving by streaming over a month', detail: 'Web or Mobile SDK, Ingestion API streaming.', kind: 'ingest_streaming', units: R / DAILY, runsPerMonth: DAILY });
    }
    a.push({ id: 'transform', label: 'A batch transform that reads it, daily', kind: 'transform_batch', units: R, runsPerMonth: DAILY });
  }
  if (obj.kind === 'dmo') {
    a.push(
      { id: 'segment-daily', label: 'A segment that reads it, published daily', detail: 'Segments bill every row they read, whatever the member count.', kind: 'segmentation', units: R, runsPerMonth: DAILY },
      { id: 'segment-rapid', label: 'The same segment every 4 hours (rapid publish)', kind: 'segmentation', units: R, runsPerMonth: everyHours(4) },
      { id: 'insight-daily', label: 'A batch calculated insight that reads it, daily', kind: 'ci_batch', units: R, runsPerMonth: DAILY },
    );
    if (isSourceProfile(obj)) {
      const rate = opts.changeRate ?? 0.05;
      a.push(
        { id: 'ir-full', label: 'Identity resolution: a full run', detail: 'The first run of a ruleset, or a rerun from scratch, counts every source profile.', kind: 'unification', units: R, runsPerMonth: 0 },
        { id: 'ir-daily', label: `Identity resolution daily, ${Math.round(rate * 1000) / 10}% of profiles changing`, detail: 'After the first run only new or changed source profiles count.', kind: 'unification', units: R * rate, runsPerMonth: DAILY },
      );
    }
    a.push({ id: 'share', label: 'Shared out zero-copy and read in full once', detail: 'By Snowflake, Databricks, BigQuery or similar.', kind: 'sharing_out', units: R, runsPerMonth: 0 });
  }
  return { actions: price(card, a), rows, reads: [{ name: obj.name, rows }] };
}

/** One run of an insight, its schedule, and the other schedules it could have. */
export function insightForecast(card: RateCard, obj: ObjectMeta, def: InsightDefinition | undefined, objects: ObjectMeta[], counts: Counts): Forecast {
  const names = def?.expression ? objectsMentioned(def.expression, objects).filter((x) => x !== obj.name) : [];
  const { rows, reads } = sizeReads(names, counts);
  const R = rows ?? PER;
  const streaming = /stream/i.test(def?.definitionType ?? '');
  const kind: ActivityKind = streaming ? 'ci_streaming' : 'ci_batch';
  const vol = rows === null ? 'per million rows read' : `reads ${n(R)} rows`;
  const sched = scheduleRuns(def?.schedule);
  const a: Action[] = [];
  if (streaming) {
    a.push({ id: 'run', label: 'Streaming: per million rows processed', detail: 'Streaming insights bill rows as they arrive, not a re-read of their inputs.', kind, units: PER, runsPerMonth: 0 });
  } else {
    a.push({ id: 'run', label: 'One run', detail: `Every run reads its inputs in full: ${vol}.`, kind, units: R, runsPerMonth: 0 });
    if (sched.known && !sched.manual) a.push({ id: 'schedule', label: `At its schedule (${scheduleText(def!.schedule!)})`, kind, units: R, runsPerMonth: sched.runs });
    for (const h of [1, 6, 12, 24]) {
      if (sched.known && Math.abs(sched.runs - everyHours(h)) < 1e-6) continue;
      a.push({ id: `every-${h}`, label: h === 24 ? 'If it ran daily' : `If it ran every ${h === 1 ? 'hour' : `${h} hours`}`, kind, units: R, runsPerMonth: everyHours(h) });
    }
  }
  const out = counts[obj.name]?.rows;
  a.push({ id: 'query', label: 'Querying its results in full, once', detail: out !== undefined ? `${n(out)} rows.` : 'Per million rows (its own row count isn’t cached).', kind: 'queries', units: out ?? PER, runsPerMonth: 0 });
  return { actions: price(card, a), rows, reads };
}

/** Rows a segment reads per refresh: the object it's built on and every object its rules use. */
export function segmentReads(seg: SegmentInfo, objects: ObjectMeta[]): string[] {
  const names = new Set(objects.map((o) => o.name));
  return [...new Set([
    ...(seg.segmentOn && names.has(seg.segmentOn) ? [seg.segmentOn] : []),
    ...objectsMentioned(`${seg.includeCriteria ?? ''} ${seg.excludeCriteria ?? ''}`, objects),
  ])];
}

/** Just the figures the segment list shows: rows per refresh, and a month at its schedule. */
export function segmentMonthly(card: RateCard, seg: SegmentInfo, objects: ObjectMeta[], counts: Counts) {
  const { rows } = sizeReads(segmentReads(seg, objects), counts);
  const sched = scheduleRuns(seg.publishInterval);
  const scheduleKnown = sched.known && !sched.manual;
  const runs = scheduleKnown ? sched.runs : DAILY;
  if (rows === null) return { rows, runs, scheduleKnown, monthly: null };
  return { rows, runs, scheduleKnown, monthly: priceAction(card, { id: 'm', label: 'm', kind: 'segmentation', units: rows, runsPerMonth: runs }).monthly };
}

export function segmentForecast(card: RateCard, seg: SegmentInfo, objects: ObjectMeta[], counts: Counts): Forecast & { scheduleKnown: boolean } {
  const { rows, reads } = sizeReads(segmentReads(seg, objects), counts);
  const R = rows ?? PER;
  const sched = scheduleRuns(seg.publishInterval);
  const known = sched.known && !sched.manual;
  const runs = known ? sched.runs : DAILY;
  const a: Action[] = [
    { id: 'refresh', label: 'One refresh', detail: rows === null ? 'Per million rows read.' : `Reads ${n(R)} rows, whatever the member count.`, kind: 'segmentation', units: R, runsPerMonth: 0 },
    {
      id: 'schedule',
      label: known ? `At its schedule (${scheduleText(seg.publishInterval!)})` : 'Published daily (its schedule isn’t known)',
      kind: 'segmentation',
      units: R,
      runsPerMonth: runs,
    },
  ];
  for (const [h, label] of [[1, 'Every hour (rapid publish)'], [4, 'Every 4 hours (rapid publish)'], [12, 'Every 12 hours'], [24, 'Daily']] as const) {
    if (Math.abs(runs - everyHours(h)) < 1e-6) continue;
    a.push({ id: `every-${h}`, label: `If published ${label.toLowerCase()}`, kind: 'segmentation', units: R, runsPerMonth: everyHours(h) });
  }
  if (seg.lastMemberCount !== undefined) {
    a.push({
      id: 'activation',
      label: `Activating its ${n(seg.lastMemberCount)} members each publish`,
      detail: 'Batch activation of the last member count; related attributes add rows.',
      kind: 'activation_batch',
      units: seg.lastMemberCount,
      runsPerMonth: runs,
    });
  }
  return { actions: price(card, a), rows, reads, scheduleKnown: known };
}

/** A query read as scanning each object it names once, in full. */
export function queryForecast(card: RateCard, names: string[], counts: Counts): Forecast {
  const { rows, reads } = sizeReads(names, counts);
  const R = rows ?? PER;
  return {
    rows,
    reads,
    actions: price(card, [
      { id: 'once', label: 'This query, once', kind: 'queries', units: R, runsPerMonth: 0 },
      { id: 'daily', label: 'Every day', kind: 'queries', units: R, runsPerMonth: DAILY },
      { id: 'hourly', label: 'Every hour', kind: 'queries', units: R, runsPerMonth: everyHours(1) },
    ]),
  };
}

/** A plan activity for an action, so it can be added to a credit plan. */
export function actionToItem(a: Action, id: string, context: string): PlanItem {
  const continuous = ACTIVITY[a.kind].continuous;
  return newItem(a.kind, id, {
    label: `${context}: ${a.label}`.slice(0, 200),
    ...(a.runsPerMonth > 0 || continuous ? { perRun: a.units, runsPerMonth: a.runsPerMonth || DAILY, initial: 0 } : { perRun: 0, runsPerMonth: 0, initial: a.units }),
    ...(a.detail ? { assumption: a.detail } : {}),
    source: context,
  });
}
