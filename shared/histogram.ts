import { quoteIdent } from './sql';

/** Metadata types where order and distance mean something, so bucketing beats "top values". */
export const LINEAR_TYPES = new Set(['NUMBER', 'DATE', 'DATE_TIME']);
export const isLinearType = (type: string): boolean => LINEAR_TYPES.has(type);
export const isDateType = (type: string): boolean => type === 'DATE' || type === 'DATE_TIME';

export interface Bar {
  label: string;
  value: number;
  /** Longer description for tooltips. */
  title?: string;
}

/** One query for everything needed to choose buckets, plus the null count. */
export function buildRangeSql(obj: { name: string }, field: string): string {
  const f = quoteIdent(field);
  return (
    `SELECT MIN(${f}) AS "min", MAX(${f}) AS "max", COUNT(${f}) AS "non_null", COUNT(*) AS "total" ` +
    `FROM ${quoteIdent(obj.name)}`
  );
}

export interface Range {
  min: unknown;
  max: unknown;
  nonNull: number;
  total: number;
}

export function parseRange(row: readonly unknown[]): Range {
  return { min: row[0], max: row[1], nonNull: Number(row[2] ?? 0), total: Number(row[3] ?? 0) };
}

// ------------------------------------------------------------------ numbers

export interface NumericBuckets {
  lo: number;
  step: number;
  count: number;
}

/** Round to 12 significant digits so 0.1 * 3 doesn't print as 0.30000000000000004. */
export const tidy = (x: number): number => Number(x.toPrecision(12));

/** "Nice" bucket edges: a step of 1, 2, 2.5 or 5 times a power of ten. */
export function chooseNumericBuckets(min: number, max: number, bins = 20): NumericBuckets {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new RangeError('Invalid numeric range');
  const span = max - min;
  const integers = Number.isInteger(min) && Number.isInteger(max);
  if (span === 0) return { lo: min, step: 1, count: 1 };
  // Few distinct integers: one bucket each reads better than ranges.
  if (integers && span < bins * 2) return { lo: min, step: 1, count: span + 1 };

  const raw = span / bins;
  const pow = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  if (integers && step < 1) step = 1;
  step = tidy(step);
  const lo = tidy(Math.floor(min / step) * step);
  return { lo, step, count: Math.floor(tidy((max - lo) / step)) + 1 };
}

/** Plain digits, for SQL. */
const num = (x: number) => String(tidy(x));
/** Thousands-separated, for people. */
const pretty = (x: number) => tidy(x).toLocaleString('en-US', { maximumFractionDigits: 12 });

export function buildNumericHistogramSql(obj: { name: string }, field: string, b: NumericBuckets): string {
  const f = quoteIdent(field);
  // Cast first: integer columns would otherwise divide as integers.
  return (
    `SELECT FLOOR((CAST(${f} AS DOUBLE PRECISION) - ${num(b.lo)}) / ${num(b.step)}) AS "bucket", COUNT(*) AS "count" ` +
    `FROM ${quoteIdent(obj.name)} WHERE ${f} IS NOT NULL GROUP BY 1 ORDER BY 1`
  );
}

export function numericBars(b: NumericBuckets, rows: readonly (readonly unknown[])[]): Bar[] {
  const counts = new Array<number>(b.count).fill(0);
  for (const r of rows) {
    const i = Math.min(Math.max(Number(r[0]), 0), b.count - 1);
    if (Number.isFinite(i)) counts[i] = (counts[i] ?? 0) + Number(r[1] ?? 0);
  }
  return counts.map((value, i) => {
    const from = tidy(b.lo + i * b.step);
    const to = tidy(b.lo + (i + 1) * b.step);
    const single = b.step === 1 && Number.isInteger(from);
    return {
      label: pretty(from),
      value,
      title: single ? `${pretty(from)}: ${value.toLocaleString('en-US')}` : `${pretty(from)} to <${pretty(to)}: ${value.toLocaleString('en-US')}`,
    };
  });
}

// -------------------------------------------------------------------- dates

export type DateUnit = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
export const DATE_UNITS: DateUnit[] = ['hour', 'day', 'week', 'month', 'quarter', 'year'];

const DAY = 86_400_000;

export function parseTimestamp(v: unknown): number {
  const s = String(v).trim();
  // Bare dates and timestamps without a zone are read as UTC.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  return Date.parse(iso);
}

/** Pick the finest unit that still gives at most ~48 buckets. */
export function chooseDateUnit(min: unknown, max: unknown): DateUnit {
  const span = parseTimestamp(max) - parseTimestamp(min);
  if (!Number.isFinite(span) || span < 0) throw new RangeError('Invalid date range');
  const days = span / DAY;
  if (days <= 2) return 'hour';
  if (days <= 48) return 'day';
  if (days <= 48 * 7) return 'week';
  if (days <= 48 * 30.5) return 'month';
  if (days <= 48 * 91.5) return 'quarter';
  return 'year';
}

export function buildDateHistogramSql(obj: { name: string }, field: string, unit: DateUnit): string {
  if (!DATE_UNITS.includes(unit)) throw new RangeError(`Unknown unit ${unit}`);
  const f = quoteIdent(field);
  return (
    `SELECT DATE_TRUNC('${unit}', ${f}) AS "bucket", COUNT(*) AS "count" ` +
    `FROM ${quoteIdent(obj.name)} WHERE ${f} IS NOT NULL GROUP BY 1 ORDER BY 1`
  );
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** Start of the bucket containing `t`, in UTC. Weeks start on Monday, as in date_trunc. */
export function truncate(t: number, unit: DateUnit): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case 'hour':
      return Date.UTC(y, m, d.getUTCDate(), d.getUTCHours());
    case 'day':
      return Date.UTC(y, m, d.getUTCDate());
    case 'week': {
      const day = Date.UTC(y, m, d.getUTCDate());
      return day - ((d.getUTCDay() + 6) % 7) * DAY;
    }
    case 'month':
      return Date.UTC(y, m, 1);
    case 'quarter':
      return Date.UTC(y, Math.floor(m / 3) * 3, 1);
    case 'year':
      return Date.UTC(y, 0, 1);
  }
}

export function nextBucket(t: number, unit: DateUnit): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case 'hour':
      return t + 3_600_000;
    case 'day':
      return t + DAY;
    case 'week':
      return t + 7 * DAY;
    case 'month':
      return Date.UTC(y, m + 1, 1);
    case 'quarter':
      return Date.UTC(y, m + 3, 1);
    case 'year':
      return Date.UTC(y + 1, 0, 1);
  }
}

export function bucketLabel(t: number, unit: DateUnit): string {
  const d = new Date(t);
  const ymd = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  switch (unit) {
    case 'hour':
      return `${ymd} ${p2(d.getUTCHours())}:00`;
    case 'day':
    case 'week':
      return ymd;
    case 'month':
      return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
    case 'quarter':
      return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case 'year':
      return String(d.getUTCFullYear());
  }
}

/** Every bucket from min to max (so empty ones show as zero), filled from the query rows. */
export function dateBars(min: unknown, max: unknown, unit: DateUnit, rows: readonly (readonly unknown[])[]): Bar[] {
  const counts = new Map<number, number>();
  for (const r of rows) {
    const t = truncate(parseTimestamp(r[0]), unit);
    if (Number.isFinite(t)) counts.set(t, (counts.get(t) ?? 0) + Number(r[1] ?? 0));
  }
  const start = truncate(parseTimestamp(min), unit);
  const end = truncate(parseTimestamp(max), unit);
  const keys = new Set<number>(counts.keys());
  // Bounded so a bad range can't produce millions of empty buckets.
  for (let t = start, n = 0; Number.isFinite(t) && t <= end && n < 2000; t = nextBucket(t, unit), n++) keys.add(t);
  return [...keys]
    .sort((a, b) => a - b)
    .map((t) => {
      const value = counts.get(t) ?? 0;
      const label = bucketLabel(t, unit);
      return { label, value, title: `${unit === 'week' ? 'week of ' : ''}${label}: ${value.toLocaleString('en-US')}` };
    });
}
