import type { CellValue } from './types';

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (a leading `=`, `+`, `@`, tab,
 * CR, or `-` not starting a number) gets a `'` prefix, since the values come from client orgs.
 */
export function csvCell(v: CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^([=+@\t\r]|-[^0-9.])/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvLine(row: readonly (CellValue | undefined)[]): string {
  return row.map(csvCell).join(',');
}
