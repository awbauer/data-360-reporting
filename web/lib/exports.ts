import type { CachedStats, ReportContext } from '@shared/report';
import type { Extras, ObjectMeta } from '@shared/types';
import { countCache, profileCache } from './storage';

export type DictionaryFormat = 'xlsx' | 'csv' | 'md';
export type HealthFormat = 'html' | 'md';

/** Whatever this browser has cached for these objects (row counts and profiles). */
export function cachedStats(host: string, dataspace: string, objects: ObjectMeta[]): CachedStats {
  const out: CachedStats = { counts: {}, profiles: {} };
  for (const o of objects) {
    const c = countCache.get(host, dataspace, o.name);
    const p = profileCache.get(host, dataspace, o.name);
    if (c) out.counts[o.name] = c;
    if (p) out.profiles[o.name] = p;
  }
  return out;
}

/** Lets Excel open the CSVs as UTF-8. */
const BOM = '\uFEFF';

const slug = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const fileBase = (kind: string, ctx: ReportContext) => `${kind}_${slug(ctx.host)}_${slug(ctx.dataspace)}_${ctx.at.toISOString().slice(0, 10)}`;

function save(data: BlobPart, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportDictionary(format: DictionaryFormat, objects: ObjectMeta[], ctx: ReportContext): Promise<void> {
  // Loaded on demand: the serializer, the zip library and the XLSX writer aren't needed until now.
  const report = await import('@shared/report');
  const tables = report.dictionaryTables(objects, cachedStats(ctx.host, ctx.dataspace, objects), ctx);
  const base = fileBase('data-dictionary', ctx);
  if (format === 'md') return save(report.dictionaryMarkdown(tables), 'text/markdown;charset=utf-8', `${base}.md`);
  if (format === 'xlsx') {
    const { buildXlsx } = await import('@shared/xlsx');
    const bytes = buildXlsx(tables.map((t) => ({ name: t.title, header: t.header, rows: t.rows })));
    return save(bytes as Uint8Array<ArrayBuffer>, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${base}.xlsx`);
  }
  const { strToU8, zipSync } = await import('fflate');
  const files = Object.fromEntries(tables.map((t) => [`${t.name}.csv`, strToU8(`${BOM}${report.tableToCsv(t)}`)]));
  save(zipSync(files) as Uint8Array<ArrayBuffer>, 'application/zip', `${base}_csv.zip`);
}

export async function exportHealth(
  format: HealthFormat,
  input: { objects: ObjectMeta[]; warnings: string[]; extras: Extras | null; extrasError?: string },
  ctx: ReportContext,
): Promise<void> {
  const report = await import('@shared/report');
  const r = report.buildHealthReport({ ...input, cached: cachedStats(ctx.host, ctx.dataspace, input.objects), ctx });
  const base = fileBase('health-check', ctx);
  if (format === 'md') save(report.reportMarkdown(r), 'text/markdown;charset=utf-8', `${base}.md`);
  else save(report.reportHtml(r), 'text/html;charset=utf-8', `${base}.html`);
}
