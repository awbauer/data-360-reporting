const nf = new Intl.NumberFormat('en-US');

export const fmtNum = (n: number): string => nf.format(n);

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Whole credits, with up to two decimals for small amounts (a 1M-row query is 3 credits). */
export function fmtCredits(x: number): string {
  if (x > 0 && x < 0.01) return '< 0.01';
  return Math.abs(x) >= 100 ? nf.format(Math.round(x)) : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(x);
}

export function fmtMoney(x: number, currency = 'USD'): string {
  try {
    // Cents only where they matter: a query costs fractions of a cent, a plan thousands.
    const digits = Math.abs(x) < 10 ? 2 : 0;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
  } catch {
    return `${nf.format(Math.round(x))} ${currency}`;
  }
}

export function fmtPct(x: number): string {
  return `${(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`;
}
