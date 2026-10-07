import { analyzeQuery } from './sqlcheck';
import type { ObjectMeta } from './types';

export interface ScanItem {
  name: string;
  label: string;
  /** null when the object has never been counted in this browser. */
  rows: number | null;
}

export interface ScanEstimate {
  items: ScanItem[];
  /** Rows in the objects whose size is known. */
  rows: number;
  /** How many referenced objects have no known size (so `rows` is a lower bound). */
  unknown: number;
  complete: boolean;
  /** A LIMIT with no aggregation can let the engine stop reading early. */
  mayStopEarly: boolean;
}

/**
 * An upper-bound guess at the rows a query reads: every object it names, read once, in full. Row
 * counts come from what this browser has counted before, so there's no query cost to estimating.
 *
 * Deliberately simple and labelled as such: we don't know how Data 360 meters joins, filters or
 * LIMIT, and the SQL is read as text, not parsed. An object named twice (a self-join) counts once.
 * Returns null when the query names no object this data space knows.
 */
export function estimateScan(
  sql: string,
  objects: Map<string, ObjectMeta>,
  rowsOf: (name: string) => number | undefined,
): ScanEstimate | null {
  const shape = analyzeQuery(sql);
  const seen = new Set<string>();
  const items: ScanItem[] = [];
  for (const ident of shape.idents) {
    const obj = objects.get(ident);
    if (!obj || seen.has(ident)) continue;
    seen.add(ident);
    const rows = rowsOf(ident);
    items.push({ name: ident, label: obj.label, rows: rows ?? null });
  }
  if (!items.length) return null;
  const unknown = items.filter((i) => i.rows === null).length;
  return {
    items,
    rows: items.reduce((n, i) => n + (i.rows ?? 0), 0),
    unknown,
    complete: unknown === 0,
    mayStopEarly: shape.hasLimit && !shape.summarises,
  };
}

/** A profile runs `batches` queries, each reading the whole object. */
export const profileRows = (objectRows: number, batches: number): number => objectRows * batches;

/**
 * Credits per million rows scanned by a query: the base-tier Flex multiplier for Data 360 Queries.
 * Kept as a literal so the rate cards stay out of the main bundle; tests/estimate.test.ts checks it
 * against them. Flex tiers lower this rate as a month's usage grows, so it is an upper bound.
 */
export const QUERY_CREDITS_PER_MILLION = 3;

export const creditsFor = (rows: number, creditsPerMillionRows: number = QUERY_CREDITS_PER_MILLION): number =>
  (rows / 1_000_000) * creditsPerMillionRows;

/** Credits for display: small amounts are shown as "<0.01" rather than rounded to nothing. */
export function fmtEstCredits(c: number): string {
  if (!Number.isFinite(c)) return '–';
  if (c === 0) return '0';
  if (c < 0.01) return '<0.01';
  if (c < 10) return c.toFixed(2).replace(/\.?0+$/, '');
  if (c < 1000) return c.toFixed(1).replace(/\.0$/, '');
  if (c < 1_000_000) return Math.round(c).toLocaleString('en-US');
  return `${(c / 1_000_000).toFixed(c < 10_000_000 ? 2 : 1).replace(/\.?0+$/, '')}M`;
}

/** "1.2M", "850K", "42". */
export function fmtRows(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return n.toLocaleString('en-US');
}
