import { creditsFor, fmtCredits, fmtMoney, fmtRows } from '@shared/credits';
import type { ScanEstimate } from '@shared/estimate';

export interface RateView {
  /** Credits per million rows for queries. */
  rate: number;
  price?: number;
  currency?: string;
}

const money = (credits: number, v: RateView) => (v.price ? ` (about ${fmtMoney(credits * v.price, v.currency)})` : '');

/** The few words shown beside the editor. */
export function scanShort(e: ScanEstimate, v: RateView): string {
  const c = creditsFor(e.rows, v.rate);
  if (e.rows === 0 && !e.complete) return 'cost unknown: count rows first';
  return `${e.complete ? '≈' : '≥'} ${fmtCredits(c)} credits`;
}

/** The full sentence, with its assumptions, for tooltips and dialogs. */
export function scanLong(e: ScanEstimate, v: RateView): string {
  const c = creditsFor(e.rows, v.rate);
  const names = e.items.filter((i) => i.rows === null).map((i) => i.label).join(', ');
  if (e.rows === 0 && !e.complete) return `Row counts for ${names} aren't known yet, so there is nothing to estimate from. Counting them takes one query each.`;
  return (
    `Reads up to ${fmtRows(e.rows)} rows${e.complete ? '' : ` in the objects counted so far (not counted: ${names})`}, ` +
    `about ${fmtCredits(c)} credits at ${v.rate} credits per million rows${money(c, v)}. ` +
    `This assumes each object is read once in full.${e.mayStopEarly ? ' A LIMIT can let the engine stop early, so the real figure may be lower.' : ''} ` +
    'It is an estimate: Salesforce reports no credit usage, and the rate is yours to confirm.'
  );
}

/** A concrete example for places that can't know the size yet. */
export function exampleCost(v: RateView, rows = 100_000_000): string {
  const c = creditsFor(rows, v.rate);
  return `At ${v.rate} credits per million rows, reading ${fmtRows(rows)} rows is about ${fmtCredits(c)} credits${money(c, v)}`;
}
