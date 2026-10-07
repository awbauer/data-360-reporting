import { QUERY_CREDITS_PER_MILLION, creditsFor, fmtEstCredits, fmtRows, type ScanEstimate } from '@shared/estimate';

/** The few words shown beside the editor. */
export function scanShort(e: ScanEstimate): string {
  if (e.rows === 0 && !e.complete) return 'cost unknown: count rows first';
  return `${e.complete ? '≈' : '≥'} ${fmtEstCredits(creditsFor(e.rows))} credits`;
}

/** The full sentence, with its assumptions, for tooltips and dialogs. */
export function scanLong(e: ScanEstimate): string {
  const names = e.items.filter((i) => i.rows === null).map((i) => i.label).join(', ');
  if (e.rows === 0 && !e.complete) return `Row counts for ${names} aren't known yet, so there is nothing to estimate from. Counting them takes one query each.`;
  return (
    `Reads up to ${fmtRows(e.rows)} rows${e.complete ? '' : ` in the objects counted so far (not counted: ${names})`}, ` +
    `about ${fmtEstCredits(creditsFor(e.rows))} credits at ${QUERY_CREDITS_PER_MILLION} credits per million rows. ` +
    `This assumes each object is read once in full.${e.mayStopEarly ? ' A LIMIT can let the engine stop early, so the real figure may be lower.' : ''} ` +
    'It is an estimate: a query reports no credits of its own, and the rate is the base-tier Flex rate (tiers lower it as a month\'s usage grows). ' +
    'What the org actually consumed is under Credits, Actual consumption.'
  );
}

/** A concrete example for places that can't know the size yet. */
export function exampleCost(rows = 100_000_000): string {
  return `At ${QUERY_CREDITS_PER_MILLION} credits per million rows, reading ${fmtRows(rows)} rows is about ${fmtEstCredits(creditsFor(rows))} credits`;
}
