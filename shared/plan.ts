// A consumption plan: how many rows each kind of work processes per run, how often it runs, and
// what that comes to in credits per month and over a growth horizon. Pure functions, so the
// numbers on screen and in the exports can't drift apart.
//
// It's a sizing aid, not a quote: see shared/credits.ts for why the rates are only defaults.
import { creditsFor, fmtCredits, fmtMoney, RATE_CARD, USAGE_IDS, usageLabel, type RateOverrides, type Rates, type UsageId } from './credits';
import type { Cell, Table } from './report';
import type { IdentityRuleset, SegmentInfo, StreamInfo } from './types';

export interface PlanLine {
  id: string;
  usage: UsageId;
  label: string;
  /** Rows the work processes each time it runs. */
  rowsPerRun: number;
  runsPerMonth: number;
  /** `org` lines came from the connected org's metadata and are replaced when it is re-read. */
  origin: 'org' | 'manual';
  note?: string;
}

export interface Plan {
  name: string;
  /** Monthly growth in rows per run, compounding. */
  growthPctPerMonth: number;
  months: number;
  lines: PlanLine[];
}

export const MAX_LINES = 500;
export const MAX_MONTHS = 36;

export function emptyPlan(name = 'Untitled plan'): Plan {
  return { name, growthPctPerMonth: 0, months: 12, lines: [] };
}

export function newLine(usage: UsageId, over: Partial<PlanLine> = {}): PlanLine {
  return { id: crypto.randomUUID(), usage, label: usageLabel(usage), rowsPerRun: 0, runsPerMonth: 30, origin: 'manual', ...over };
}

/** Clamp what came back from storage into something safe to compute with. */
export function sanitizePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<Plan>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const lines = (Array.isArray(p.lines) ? p.lines : [])
    .slice(0, MAX_LINES)
    .filter((l): l is PlanLine => Boolean(l) && typeof l === 'object' && USAGE_IDS.includes((l as PlanLine).usage))
    .map((l) => ({
      id: typeof l.id === 'string' && l.id ? l.id.slice(0, 80) : crypto.randomUUID(),
      usage: l.usage,
      label: String(l.label ?? '').slice(0, 120),
      rowsPerRun: num(l.rowsPerRun, 0, 1e13, 0),
      runsPerMonth: num(l.runsPerMonth, 0, 100_000, 0),
      origin: l.origin === 'org' ? ('org' as const) : ('manual' as const),
      ...(l.note ? { note: String(l.note).slice(0, 300) } : {}),
    }));
  return {
    name: String(p.name ?? 'Untitled plan').slice(0, 80),
    growthPctPerMonth: num(p.growthPctPerMonth, -50, 100, 0),
    months: Math.round(num(p.months, 1, MAX_MONTHS, 12)),
    lines,
  };
}

// ------------------------------------------------------------------ arithmetic

/** Credits one line consumes in month `m` (0 is the first month). */
export function lineCredits(line: PlanLine, rate: number, growthPct: number, m = 0): number {
  const rows = line.rowsPerRun * (1 + growthPct / 100) ** m;
  return creditsFor(rows, rate) * line.runsPerMonth;
}

export interface PlanSummary {
  /** Month 1 by usage type, largest first, non-zero only. */
  byUsage: { usage: UsageId; credits: number; share: number }[];
  perLine: { id: string; month1: number; total: number }[];
  /** Total credits for each month of the horizon. */
  monthly: number[];
  month1: number;
  total: number;
}

export function summarizePlan(plan: Plan, rates: Rates): PlanSummary {
  const g = plan.growthPctPerMonth;
  const months = Math.max(1, Math.min(MAX_MONTHS, plan.months));
  const monthly = Array.from({ length: months }, () => 0);
  const usage = new Map<UsageId, number>();
  const perLine = plan.lines.map((l) => {
    let total = 0;
    for (let m = 0; m < months; m++) {
      const c = lineCredits(l, rates[l.usage], g, m);
      monthly[m]! += c;
      total += c;
    }
    const month1 = lineCredits(l, rates[l.usage], g, 0);
    usage.set(l.usage, (usage.get(l.usage) ?? 0) + month1);
    return { id: l.id, month1, total };
  });
  const month1 = monthly[0] ?? 0;
  return {
    byUsage: [...usage]
      .filter(([, c]) => c > 0)
      .map(([u, c]) => ({ usage: u, credits: c, share: month1 > 0 ? c / month1 : 0 }))
      .sort((a, b) => b.credits - a.credits),
    perLine,
    monthly,
    month1,
    total: monthly.reduce((a, b) => a + b, 0),
  };
}

// ------------------------------------------------------------------ prefill

/** How many times a stream refreshes in a month, from the API's `refreshConfig.frequency`. */
export function runsPerMonthFromFrequency(freq?: string): number | null {
  const f = (freq ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (['daily', 'twentyfourhours', 'everyday'].includes(f)) return 30;
  if (f === 'hourly') return 720;
  if (f === 'weekly') return 4;
  if (f === 'monthly') return 1;
  return null;
}

const HOUR_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, six: 6, eight: 8, twelve: 12, twentyfour: 24, daily: 24, hourly: 1 };

/** Publishes per month from a segment's `publishInterval` (hours between runs), 0 when not scheduled. */
export function runsPerMonthFromPublishInterval(v?: string): number | null {
  const f = (v ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!f) return null;
  if (['norefresh', 'notscheduled', 'none'].includes(f)) return 0;
  const hours = HOUR_WORDS[f];
  return hours ? Math.round((30 * 24) / hours) : null;
}

/** "every 12 hours", "not scheduled"; falls back to the API's own words. */
export function describePublishInterval(v?: string): string {
  const f = (v ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!f) return 'unknown';
  if (['norefresh', 'notscheduled', 'none'].includes(f)) return 'not scheduled';
  const hours = HOUR_WORDS[f];
  if (hours) return hours === 1 ? 'every hour' : `every ${hours} hours`;
  return (v ?? '').toLowerCase().replace(/_/g, ' ');
}

export interface PrefillInput {
  streams: StreamInfo[];
  segments: SegmentInfo[];
  identity: IdentityRuleset[];
  /** Cached row counts by object API name, to size segmentation. */
  rowsOf?: (name: string) => number | undefined;
}

/**
 * Starting lines from what the connected org reports. Every number is a guess to be corrected:
 * it assumes the last run is typical, that streams are batch, and says so in each line's note.
 */
export function prefillLines({ streams, segments, identity, rowsOf }: PrefillInput): PlanLine[] {
  const lines: PlanLine[] = [];

  for (const s of streams) {
    const rows = s.lastProcessedRecords ?? s.lastAddedRecords ?? s.totalRecords ?? 0;
    const known = runsPerMonthFromFrequency(s.refreshFrequency);
    lines.push({
      id: `org:stream:${s.name}`,
      usage: 'ingest-batch',
      label: `Stream: ${s.label}`,
      rowsPerRun: rows,
      runsPerMonth: known ?? 30,
      origin: 'org',
      note:
        `${s.lastProcessedRecords !== undefined ? 'Rows from its last run' : s.lastAddedRecords !== undefined ? 'Rows added by its last run' : 'Its total record count'}` +
        `${s.refreshMode ? `; refresh mode ${s.refreshMode.toLowerCase().replace(/_/g, ' ')}` : ''}. ` +
        `${known === null ? `Assumes daily${s.refreshFrequency ? ` (frequency '${s.refreshFrequency}' not recognised)` : ' (frequency not reported)'}. ` : ''}` +
        'Treated as batch: switch to streaming for SDK and ingestion-API streams.',
    });
  }

  for (const r of identity) {
    lines.push({
      id: `org:identity:${r.label}`,
      usage: 'unification',
      label: `Identity resolution: ${r.label}`,
      rowsPerRun: r.sourceProfiles ?? 0,
      runsPerMonth: r.runsAutomatically ? 30 : 1,
      origin: 'org',
      note: `Source profiles from the ruleset${r.runsAutomatically ? '; assumes it runs daily' : '; not set to run automatically, so one run a month is assumed'}. Unification is by far the most expensive rate: check this line first.`,
    });
  }

  const unified = identity.reduce((n, r) => Math.max(n, r.totalUnifiedProfiles ?? 0), 0);
  for (const s of segments) {
    const runs = runsPerMonthFromPublishInterval(s.publishInterval);
    // Segmentation reads the segmented-on object; unified profiles are the usual one.
    const fromObject = s.segmentOn ? rowsOf?.(s.segmentOn) : undefined;
    const rows = fromObject ?? (unified || 0);
    lines.push({
      id: `org:segment:${s.apiName}`,
      usage: 'segmentation',
      label: `Segment: ${s.label}`,
      rowsPerRun: rows,
      runsPerMonth: runs ?? 30,
      origin: 'org',
      note:
        `${fromObject !== undefined ? `Rows in ${s.segmentOn}` : unified ? 'Unified profiles from identity resolution' : 'No size known: enter the rows in the segmented object'}. ` +
        `${runs === 0 ? 'Not scheduled to publish, so no runs are assumed. ' : runs === null ? `Publish interval ${s.publishInterval ? `'${s.publishInterval}' not recognised` : 'not reported'}; assumes daily. ` : ''}` +
        'Segment complexity may change what is billed.',
    });
  }
  return lines;
}

/** Replace the lines that came from the org, keep the ones the person added. */
export function applyPrefill(plan: Plan, fresh: PlanLine[]): Plan {
  return { ...plan, lines: [...plan.lines.filter((l) => l.origin !== 'org'), ...fresh].slice(0, MAX_LINES) };
}

// ------------------------------------------------------------------ export

export interface PlanContext {
  host: string | null;
  dataspace: string | null;
  at: Date;
  preparedBy?: string;
}

const pct = (x: number) => Math.round(x * 1000) / 10;

/** Tables for the XLSX/CSV/Markdown exports: the numbers, plus every assumption behind them. */
export function planTables(plan: Plan, summary: PlanSummary, rates: Rates, overrides: RateOverrides | undefined, ctx: PlanContext): Table[] {
  const price = overrides?.pricePerCredit;
  const cur = overrides?.currency ?? 'USD';
  const money = (c: number): Cell => (price ? Math.round(c * price * 100) / 100 : null);
  const confirmed = Boolean(overrides?.confirmed);

  const about: Table = {
    name: 'about',
    title: plan.name,
    header: ['Item', 'Value'],
    rows: [
      ['Plan', plan.name],
      ['Org', ctx.host ?? '(not tied to an org)'],
      ['Data space', ctx.dataspace ?? ''],
      ['Prepared', ctx.at.toISOString().replace(/\.\d{3}Z$/, 'Z')],
      ['Prepared by', ctx.preparedBy ?? ''],
      ['First month, credits', Math.round(summary.month1)],
      [`Total over ${plan.months} months, credits`, Math.round(summary.total)],
      ...(price ? ([[`Price per credit (${cur})`, price], [`First month, ${cur}`, money(summary.month1)], [`Total over ${plan.months} months, ${cur}`, money(summary.total)]] as [string, Cell][]) : []),
      ['Monthly growth in rows per run, %', plan.growthPctPerMonth],
      [
        'Rates',
        confirmed
          ? 'Confirmed against the customer contract by the preparer.'
          : `UNVERIFIED defaults (${RATE_CARD.asOf}). Replace with contract rates before relying on this.`,
      ],
      ['What this is', 'An estimate from row counts and the rates below. Salesforce reports no credit figures through its API, so none of it is measured, and it is not a quote.'],
      ['Not modelled', 'Storage (billed per terabyte), volume tiers and sandbox discounts, add-on products, and how Salesforce counts rows for joins, filters or LIMIT.'],
    ],
  };

  const byUsage: Table = {
    name: 'by-usage',
    title: 'Credits by usage type (first month)',
    header: ['Usage type', 'Credits per million rows', 'Credits', 'Share %', ...(price ? [`Cost (${cur})`] : [])],
    rows: summary.byUsage.map((u) => [usageLabel(u.usage), rates[u.usage], Math.round(u.credits), pct(u.share), ...(price ? [money(u.credits)] : [])]),
  };

  const lines: Table = {
    name: 'lines',
    title: 'Lines',
    header: ['Usage type', 'Line', 'Rows per run', 'Runs per month', 'Credits per million rows', 'First month, credits', `Total over ${plan.months} months, credits`, 'Source', 'Note'],
    rows: plan.lines.map((l) => {
      const s = summary.perLine.find((x) => x.id === l.id);
      return [usageLabel(l.usage), l.label, l.rowsPerRun, l.runsPerMonth, rates[l.usage], Math.round(s?.month1 ?? 0), Math.round(s?.total ?? 0), l.origin === 'org' ? 'Read from org' : 'Entered', l.note ?? null];
    }),
  };

  const projection: Table = {
    name: 'projection',
    title: 'Projection by month',
    header: ['Month', 'Credits', ...(price ? [`Cost (${cur})`] : [])],
    rows: summary.monthly.map((c, i) => [i + 1, Math.round(c), ...(price ? [money(c)] : [])]),
  };

  const card: Table = {
    name: 'rates',
    title: 'Rates used',
    header: ['Usage type', 'Credits per million rows', 'Default', 'Changed', 'Counts', 'Note'],
    rows: RATE_CARD.usage.map((u) => [u.label, rates[u.id], u.rate, rates[u.id] !== u.rate ? 'yes' : null, u.unit, u.note ?? null]),
  };

  return [about, byUsage, lines, projection, card];
}

/** One-line summary for toasts and tooltips. */
export function describeTotal(summary: PlanSummary, overrides?: RateOverrides): string {
  const price = overrides?.pricePerCredit;
  const money = price ? ` (${fmtMoney(summary.month1 * price, overrides?.currency)})` : '';
  return `${fmtCredits(summary.month1)} credits in the first month${money}`;
}
