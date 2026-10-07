// Data 360 consumption credits: the rate card and the arithmetic around it.
//
// IMPORTANT: Salesforce's API reports no credit or consumption figures at all (the Connect API
// spec has no usage endpoint, and a query's status carries only a result row count). Everything
// built on this file is an ESTIMATE from row counts and a rate card, never a measurement.
// The rates below were taken from secondary summaries of Salesforce's rate cards because the
// originals could not be read when they were written, and the summaries disagree in places. They
// are defaults to be checked against the customer's contract, not facts.

export type UsageId =
  | 'query'
  | 'ingest-batch'
  | 'ingest-stream'
  | 'transform-batch'
  | 'transform-stream'
  | 'unification'
  | 'segmentation'
  | 'activation';

export interface UsageType {
  id: UsageId;
  label: string;
  /** Credits per million rows processed. */
  rate: number;
  /** What counts as a processed row for this type, in plain words. */
  unit: string;
  note?: string;
}

export interface RateCard {
  asOf: string;
  /** False until someone has checked the rates against a contract. */
  verified: boolean;
  source: string;
  usage: UsageType[];
}

export const RATE_CARD: RateCard = {
  asOf: '2026-10-07',
  verified: false,
  source:
    "Secondary summaries of Salesforce's Data 360 Flex Credits Rate Card and Data Cloud Platform Services Rate Sheet. " +
    'The original documents could not be read when these defaults were written and the summaries differ between versions. ' +
    'Volume tiers and sandbox discounts are not modelled. Check every rate against your contract.',
  usage: [
    { id: 'query', label: 'Data queries', rate: 3, unit: 'rows read by a query' },
    { id: 'ingest-batch', label: 'Ingestion, batch', rate: 2000, unit: 'rows ingested per run' },
    { id: 'ingest-stream', label: 'Ingestion, streaming', rate: 5000, unit: 'rows ingested' },
    {
      id: 'transform-batch',
      label: 'Data transforms, batch',
      rate: 400,
      unit: 'rows processed per run',
      note: "One summary lists a 'Data 360 Prep' line at 40 credits per million rows. Confirm which line applies to you.",
    },
    { id: 'transform-stream', label: 'Data transforms, streaming', rate: 5000, unit: 'rows processed' },
    { id: 'unification', label: 'Identity unification', rate: 75000, unit: 'source profiles processed per run' },
    { id: 'segmentation', label: 'Segmentation', rate: 50, unit: 'rows in the segmented object per publish' },
    { id: 'activation', label: 'Activation', rate: 60, unit: 'rows activated per run' },
  ],
};

export const USAGE_IDS = RATE_CARD.usage.map((u) => u.id);
export const usageLabel = (id: UsageId): string => RATE_CARD.usage.find((u) => u.id === id)?.label ?? id;

/** What a person has changed from the defaults (kept per user, on the server). */
export interface RateOverrides {
  rates?: Partial<Record<UsageId, number>>;
  /** Cost of one credit, in `currency`. Unset until the person enters their contract price. */
  pricePerCredit?: number;
  currency?: string;
  /** The person has checked the rates against their contract. */
  confirmed?: boolean;
}

export type Rates = Record<UsageId, number>;

export function effectiveRates(o?: RateOverrides): Rates {
  const out = {} as Rates;
  for (const u of RATE_CARD.usage) {
    const v = o?.rates?.[u.id];
    out[u.id] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : u.rate;
  }
  return out;
}

/** Overrides that differ from the defaults (so the editor can mark them and reset them). */
export function changedRates(o?: RateOverrides): UsageId[] {
  const r = effectiveRates(o);
  return RATE_CARD.usage.filter((u) => r[u.id] !== u.rate).map((u) => u.id);
}

export const creditsFor = (rows: number, creditsPerMillionRows: number): number => (rows / 1_000_000) * creditsPerMillionRows;

export function fmtCredits(c: number): string {
  if (!Number.isFinite(c)) return '–';
  if (c === 0) return '0';
  if (c < 0.01) return '<0.01';
  if (c < 10) return c.toFixed(2).replace(/\.?0+$/, '');
  if (c < 1000) return c.toFixed(1).replace(/\.0$/, '');
  if (c < 1_000_000) return Math.round(c).toLocaleString('en-US');
  return `${(c / 1_000_000).toFixed(c < 10_000_000 ? 2 : 1).replace(/\.?0+$/, '')}M`;
}

export function fmtMoney(amount: number, currency = 'USD'): string {
  if (!Number.isFinite(amount)) return '–';
  const abs = Math.abs(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: abs < 1 ? 3 : abs < 100 ? 2 : 0,
  }).format(amount);
}

/** "1.2M", "850K", "42". */
export function fmtRows(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return n.toLocaleString('en-US');
}

/** Clamp whatever came back from storage into something safe to compute with. */
export function sanitizeOverrides(raw: unknown): RateOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as RateOverrides;
  const out: RateOverrides = {};
  const rates: Partial<Record<UsageId, number>> = {};
  for (const id of USAGE_IDS) {
    const v = o.rates?.[id];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9) rates[id] = v;
  }
  if (Object.keys(rates).length) out.rates = rates;
  if (typeof o.pricePerCredit === 'number' && Number.isFinite(o.pricePerCredit) && o.pricePerCredit > 0 && o.pricePerCredit <= 1000) out.pricePerCredit = o.pricePerCredit;
  if (typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency)) out.currency = o.currency.toUpperCase();
  if (o.confirmed === true) out.confirmed = true;
  return out;
}

/**
 * Reads a row count the way people type it: `2500000`, `2,500,000`, `2.5m`, `500k`, `1.2B`.
 * Returns null for anything else, so the caller can keep the old value.
 */
export function parseRows(text: string): number | null {
  const m = /^\s*([0-9][0-9,_]*(?:\.[0-9]+)?|\.[0-9]+)\s*([kmb])?\s*$/i.exec(text);
  if (!m) return null;
  const base = Number(m[1]!.replace(/[,_]/g, ''));
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  const n = Math.round(base * mult);
  return Number.isFinite(n) && n >= 0 && n <= 1e13 ? n : null;
}
