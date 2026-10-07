// One serializer for the data dictionary (#5) and the org health check (#6). Both are built
// only from metadata and list responses already loaded, plus aggregates cached in the browser,
// so exporting never runs a query and never contains row data.
import { toCsvLine } from './csv';
import { computeOverview } from './overview';
import type { ObjectProfile } from './sql';
import type { Extras, ObjectKind, ObjectMeta, Relationship } from './types';

export type Cell = string | number | boolean | null;

export interface Table {
  /** Short name: file name for CSV, sheet name for XLSX. */
  name: string;
  title: string;
  header: string[];
  rows: Cell[][];
  note?: string;
}

export interface ReportContext {
  host: string;
  dataspace: string;
  at: Date;
}

/** Aggregates the browser cached earlier (row counts and profiles), keyed by object name. */
export interface CachedStats {
  counts: Record<string, { rows: number; at: string }>;
  profiles: Record<string, ObjectProfile>;
}

const KIND: Record<ObjectKind, string> = { dmo: 'Data model object', dlo: 'Data lake object', ci: 'Calculated insight' };
const pct = (x: number) => Math.round(x * 1000) / 10;
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Relationships appear on both ends' metadata; count each once. */
export function uniqueRelationships(objects: ObjectMeta[]): Relationship[] {
  const seen = new Map<string, Relationship>();
  for (const o of objects) {
    for (const r of o.relationships) {
      const key = [r.fromEntity, r.toEntity, r.fromEntityAttribute ?? '', r.toEntityAttribute ?? ''].join('|');
      if (!seen.has(key)) seen.set(key, r);
    }
  }
  return [...seen.values()].sort((a, b) => a.fromEntity.localeCompare(b.fromEntity) || a.toEntity.localeCompare(b.toEntity));
}

function aboutTable(title: string, ctx: ReportContext, extra: [string, Cell][] = []): Table {
  return {
    name: 'about',
    title,
    header: ['Item', 'Value'],
    rows: [['Org', ctx.host], ['Data space', ctx.dataspace], ['Generated', stamp(ctx.at)], ...extra],
  };
}

export function dictionaryTables(objects: ObjectMeta[], cached: CachedStats, ctx: ReportContext): Table[] {
  const sorted = [...objects].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const rels = uniqueRelationships(objects);
  const relCount = new Map<string, number>();
  for (const r of rels) for (const n of new Set([r.fromEntity, r.toEntity])) relCount.set(n, (relCount.get(n) ?? 0) + 1);
  const profiled = sorted.filter((o) => cached.profiles[o.name]).length;

  const about = aboutTable('Data dictionary', ctx, [
    ['Objects', sorted.length],
    ['Fields', sorted.reduce((n, o) => n + o.fields.length, 0)],
    ['Relationships', rels.length],
    ['Objects with cached row counts', sorted.filter((o) => cached.counts[o.name]).length],
    ['Objects with cached profiles', profiled],
    ['Note', 'Metadata only, no row data. Row counts and profile statistics were cached in the exporting browser; their columns say when each was computed. Distinct counts are approximate.'],
  ]);

  const objectsTable: Table = {
    name: 'objects',
    title: 'Objects',
    header: ['Object', 'Label', 'Kind', 'Category', 'Fields', 'Primary key', 'Relationships', 'Rows (cached)', 'Rows counted at', 'Profiled at'],
    rows: sorted.map((o) => {
      const c = cached.counts[o.name];
      return [
        o.name, o.label, KIND[o.kind], o.category, o.fields.length, o.primaryKeys.join(', '), relCount.get(o.name) ?? 0,
        c?.rows ?? null, c?.at ?? null, cached.profiles[o.name]?.computedAt ?? null,
      ];
    }),
  };

  const fields: Table = {
    name: 'fields',
    title: 'Fields',
    header: [
      'Object', 'Object label', 'Kind', 'Field', 'Label', 'Type', 'Business type', 'Primary key', 'Key qualifier', 'Role',
      'Non-null % (cached)', 'Approx. distinct (cached)', 'Min (cached)', 'Max (cached)', 'Profiled at',
    ],
    rows: sorted.flatMap((o) =>
      o.fields.map((f) => {
        const p = cached.profiles[o.name];
        const fp = p?.fields[f.name];
        return [
          o.name, o.label, KIND[o.kind], f.name, f.label, f.type, f.businessType ?? null, f.isPk ? 'yes' : null,
          f.keyQualifier ?? null, f.role ?? null,
          fp ? pct(1 - fp.nullRate) : null, fp ? fp.distinct : null,
          fp?.min === undefined ? null : fp.min, fp?.max === undefined ? null : fp.max, fp ? p!.computedAt : null,
        ];
      }),
    ),
  };

  const relationships: Table = {
    name: 'relationships',
    title: 'Relationships',
    header: ['From object', 'From field', 'To object', 'To field', 'Cardinality'],
    rows: rels.map((r) => [r.fromEntity, r.fromEntityAttribute ?? null, r.toEntity, r.toEntityAttribute ?? null, r.cardinality ?? null]),
  };

  return [about, objectsTable, fields, relationships];
}

export function tableToCsv(t: Table): string {
  return [t.header, ...t.rows].map((r) => toCsvLine(r)).join('\n') + '\n';
}

// ------------------------------------------------------------------ markdown

const mdCell = (v: Cell | undefined) => (v === null || v === undefined ? '' : String(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function tableToMarkdown(t: Table): string {
  const lines = [`| ${t.header.map(mdCell).join(' | ')} |`, `| ${t.header.map(() => '---').join(' | ')} |`];
  for (const r of t.rows) lines.push(`| ${r.map(mdCell).join(' | ')} |`);
  return lines.join('\n');
}

/** A document from tables: the first is a key/value summary, the rest become sections. */
export function tablesToMarkdown(title: string, tables: Table[]): string {
  const [about, ...rest] = tables;
  const head = about!.rows.map(([k, v]) => `- **${mdCell(k)}:** ${mdCell(v)}`).join('\n');
  return [`# ${title}`, head, ...rest.map((t) => `## ${t.title}\n\n${t.rows.length ? tableToMarkdown(t) : '_None._'}`)].join('\n\n') + '\n';
}

export function dictionaryMarkdown(tables: Table[]): string {
  return tablesToMarkdown('Data dictionary', tables);
}

// -------------------------------------------------------------- health report

export interface Section {
  title: string;
  /** Why the section has no data (an endpoint failed, nothing cached yet). */
  unavailable?: string;
  paragraphs?: string[];
  facts?: [string, string | number][];
  tables?: Table[];
}

export interface HealthReport {
  title: string;
  ctx: ReportContext;
  sections: Section[];
  /** Sections or inputs that couldn't be produced, listed up front. */
  gaps: string[];
}

export interface HealthInput {
  objects: ObjectMeta[];
  /** Metadata warnings (an entity type that failed to load). */
  warnings: string[];
  /** null when the streams/segments request itself failed. */
  extras: Extras | null;
  extrasError?: string;
  cached: CachedStats;
  ctx: ReportContext;
}

const failedRun = (s: string | undefined) => /fail|error/i.test(s ?? '');

export function buildHealthReport(input: HealthInput): HealthReport {
  const { objects, cached, ctx } = input;
  const stats = computeOverview(objects);
  const gaps: string[] = [...input.warnings.map((w) => `Metadata partly unavailable: ${w}`)];
  const sections: Section[] = [];

  // Summary
  const streams = input.extras?.dataStreams ?? null;
  const segments = input.extras?.segments ?? null;
  const extrasErrors = input.extrasError ? [input.extrasError] : (input.extras?.errors ?? []);
  sections.push({
    title: 'Summary',
    facts: [
      ['Data model objects', `${stats.counts.dmo}${stats.dmoByCategory.length ? ` (${stats.dmoByCategory.map(([c, n]) => `${n} ${c}`).join(', ')})` : ''}`],
      ['Data lake objects', stats.counts.dlo],
      ['Calculated insights', stats.counts.ci],
      ['Fields', stats.totalFields],
      ['Relationships', stats.relationships],
      ['Data model objects without relationships', stats.isolated.length],
      ['Data streams', streams ? `${streams.total}${streams.truncated ? '+' : ''} (${streams.items.filter((s) => failedRun(s.lastRunStatus)).length} failed last run)` : 'unavailable'],
      ['Segments', segments ? `${segments.total}${segments.truncated ? '+' : ''} (${segments.items.filter((s) => /success/i.test(s.publishStatus ?? '')).length} published)` : 'unavailable'],
    ],
  });

  // Model inventory
  sections.push({
    title: 'Model inventory',
    tables: [
      {
        name: 'categories',
        title: 'Data model objects by category',
        header: ['Category', 'Objects'],
        rows: stats.dmoByCategory.map(([c, n]) => [c, n]),
      },
      {
        name: 'field-types',
        title: 'Field types',
        header: ['Type', 'Fields', 'Share %'],
        rows: stats.typeMix.map(([t, n]) => [t, n, stats.totalFields ? pct(n / stats.totalFields) : 0]),
      },
      {
        name: 'connected',
        title: 'Most connected objects',
        header: ['Object', 'Label', 'Related objects'],
        rows: stats.mostConnected.map((o) => [o.name, o.label, o.neighbors]),
      },
    ],
  });

  sections.push({
    title: 'Objects without relationships',
    paragraphs: stats.isolated.length
      ? ['Data model objects with no relationships to any other object. They may be unmapped, orphaned or simply standalone; check whether each is expected.']
      : ['Every data model object has at least one relationship.'],
    tables: stats.isolated.length
      ? [{ name: 'isolated', title: 'Objects without relationships', header: ['Object', 'Label', 'Category', 'Fields'], rows: stats.isolated.map((o) => [o.name, o.label, o.category, o.fields.length]) }]
      : [],
  });

  // Data streams
  if (!streams) {
    const why = extrasErrors.find((e) => /stream/i.test(e)) ?? extrasErrors[0] ?? 'not loaded';
    gaps.push(`Data streams: ${why}`);
    sections.push({ title: 'Data streams', unavailable: why });
  } else {
    const byStatus = new Map<string, number>();
    for (const s of streams.items) byStatus.set(s.lastRunStatus ?? 'unknown', (byStatus.get(s.lastRunStatus ?? 'unknown') ?? 0) + 1);
    const failed = streams.items.filter((s) => failedRun(s.lastRunStatus));
    sections.push({
      title: 'Data streams',
      paragraphs: [
        `${streams.total}${streams.truncated ? '+' : ''} data streams (org-wide).${streams.truncated ? ` Only the first ${streams.items.length} were read.` : ''}`,
        failed.length ? `${failed.length} failed on their last run.` : 'None failed on their last run.',
      ],
      tables: [
        { name: 'stream-status', title: 'By last run status', header: ['Last run status', 'Streams'], rows: [...byStatus].sort((a, b) => b[1] - a[1]) },
        ...(failed.length
          ? [{
              name: 'failed-streams',
              title: 'Streams whose last run failed',
              header: ['Stream', 'Label', 'Data lake object', 'Last refresh', 'Records'],
              rows: failed.map((s): Cell[] => [s.name, s.label, s.dataLakeObject ?? null, s.lastRefreshDate ?? null, s.totalRecords ?? null]),
            }]
          : []),
      ],
    });
  }

  // Segments
  if (!segments) {
    const why = extrasErrors.find((e) => /segment/i.test(e)) ?? extrasErrors[0] ?? 'not loaded';
    gaps.push(`Segments: ${why}`);
    sections.push({ title: 'Segments', unavailable: why });
  } else {
    const byPublish = new Map<string, number>();
    for (const s of segments.items) byPublish.set(s.publishStatus ?? 'never published', (byPublish.get(s.publishStatus ?? 'never published') ?? 0) + 1);
    sections.push({
      title: 'Segments',
      paragraphs: [`${segments.total}${segments.truncated ? '+' : ''} segments in data space ${ctx.dataspace}.${segments.truncated ? ` Only the first ${segments.items.length} were read.` : ''}`],
      tables: [
        { name: 'segment-publish', title: 'By publish status', header: ['Publish status', 'Segments'], rows: [...byPublish].sort((a, b) => b[1] - a[1]) },
        {
          name: 'segments',
          title: 'Segments',
          header: ['Segment', 'Label', 'Status', 'Publish status', 'Last member count', 'Last published'],
          rows: segments.items.map((s) => [s.apiName, s.label, s.status ?? null, s.publishStatus ?? null, s.lastMemberCount ?? null, s.lastPublished ?? null]),
        },
      ],
    });
  }

  // Field completeness from cached profiles
  const profiled = objects.filter((o) => cached.profiles[o.name]);
  if (!profiled.length) {
    gaps.push('Field completeness: no objects have been profiled in this browser');
    sections.push({ title: 'Field completeness', unavailable: 'No objects have been profiled in this browser. Profile objects in the Explorer to include this section.' });
  } else {
    const worst: Cell[][] = [];
    const perObject = profiled.map((o) => {
      const p = cached.profiles[o.name]!;
      const fs = Object.entries(p.fields);
      const complete = fs.map(([, f]) => 1 - f.nullRate);
      for (const [name, f] of fs) worst.push([o.name, name, pct(1 - f.nullRate), f.nonNull, p.rows]);
      return [
        o.name, o.label, p.computedAt, p.rows, fs.length,
        complete.length ? pct(complete.reduce((a, b) => a + b, 0) / complete.length) : null,
        complete.filter((c) => c < 0.5).length,
      ] as Cell[];
    });
    worst.sort((a, b) => Number(a[2]) - Number(b[2]));
    sections.push({
      title: 'Field completeness',
      paragraphs: [
        `${profiled.length} of ${objects.length} objects have been profiled in this browser. Figures are as of each object's profile time and are approximate for distinct counts.`,
      ],
      tables: [
        { name: 'completeness', title: 'Profiled objects', header: ['Object', 'Label', 'Profiled at', 'Rows', 'Fields', 'Average non-null %', 'Fields under 50% non-null'], rows: perObject },
        { name: 'least-complete', title: 'Least complete fields (up to 25)', header: ['Object', 'Field', 'Non-null %', 'Non-null rows', 'Rows'], rows: worst.slice(0, 25) },
      ],
    });
  }

  const counted = objects.filter((o) => cached.counts[o.name]);
  if (counted.length) {
    sections.push({
      title: 'Row counts',
      paragraphs: [`${counted.length} of ${objects.length} objects have cached row counts.`],
      tables: [{
        name: 'row-counts',
        title: 'Largest objects',
        header: ['Object', 'Label', 'Rows', 'Counted at'],
        rows: counted
          .map((o) => [o.name, o.label, cached.counts[o.name]!.rows, cached.counts[o.name]!.at] as Cell[])
          .sort((a, b) => Number(b[2]) - Number(a[2]))
          .slice(0, 25),
      }],
    });
  }

  return { title: 'Data 360 org health check', ctx, sections, gaps };
}

export function reportMarkdown(r: HealthReport): string {
  const out = [
    `# ${r.title}`,
    `- **Org:** ${mdCell(r.ctx.host)}\n- **Data space:** ${mdCell(r.ctx.dataspace)}\n- **Generated:** ${stamp(r.ctx.at)}`,
    'Built from metadata and cached aggregates only; no queries were run to produce it.',
  ];
  if (r.gaps.length) out.push(`**Not included:**\n\n${r.gaps.map((g) => `- ${mdCell(g)}`).join('\n')}`);
  for (const s of r.sections) {
    out.push(`## ${s.title}`);
    if (s.unavailable) {
      out.push(`_Unavailable: ${mdCell(s.unavailable)}_`);
      continue;
    }
    for (const p of s.paragraphs ?? []) out.push(p);
    if (s.facts) out.push(s.facts.map(([k, v]) => `- **${mdCell(k)}:** ${mdCell(v)}`).join('\n'));
    for (const t of s.tables ?? []) out.push(`### ${t.title}\n\n${t.rows.length ? tableToMarkdown(t) : '_None._'}`);
  }
  return out.join('\n\n') + '\n';
}

const h = (v: Cell | undefined) =>
  (v === null || v === undefined ? '' : String(v)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tableHtml(t: Table): string {
  if (!t.rows.length) return `<h3>${h(t.title)}</h3><p class="muted">None.</p>`;
  const num = t.header.map((_, i) => t.rows.every((r) => r[i] === null || typeof r[i] === 'number'));
  return (
    `<h3>${h(t.title)}</h3><table><thead><tr>${t.header.map((c, i) => `<th${num[i] ? ' class="n"' : ''}>${h(c)}</th>`).join('')}</tr></thead><tbody>` +
    t.rows.map((r) => `<tr>${r.map((c, i) => `<td${num[i] ? ' class="n"' : ''}>${h(typeof c === 'number' ? c.toLocaleString('en-US') : c)}</td>`).join('')}</tr>`).join('') +
    '</tbody></table>'
  );
}

/** A self-contained, printable page (no scripts, no external resources). */
export function reportHtml(r: HealthReport): string {
  const body = r.sections
    .map((s) => {
      if (s.unavailable) return `<section><h2>${h(s.title)}</h2><p class="gap">Unavailable: ${h(s.unavailable)}</p></section>`;
      return (
        `<section><h2>${h(s.title)}</h2>` +
        (s.paragraphs ?? []).map((p) => `<p>${h(p)}</p>`).join('') +
        (s.facts ? `<dl>${s.facts.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('')}</dl>` : '') +
        (s.tables ?? []).map(tableHtml).join('') +
        '</section>'
      );
    })
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(r.title)} · ${h(r.ctx.host)} · ${h(r.ctx.dataspace)}</title>
<style>
  :root { color-scheme: light; --text: #1b1f24; --muted: #5d6670; --border: #d8dde3; --bad: #b42318; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); background: #fff; margin: 0 auto; max-width: 960px; padding: 32px 24px; }
  h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 28px 0 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  h3 { font-size: 14px; margin: 16px 0 6px; } p { margin: 6px 0; } .muted, .meta { color: var(--muted); } .gap { color: var(--bad); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 8px 0; } dt { color: var(--muted); } dd { margin: 0; font-variant-numeric: tabular-nums; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin: 4px 0 12px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: top; overflow-wrap: anywhere; }
  th { color: var(--muted); font-weight: 600; } .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .gaps { border: 1px solid var(--border); border-left: 3px solid var(--bad); padding: 8px 12px; margin: 16px 0; }
  @page { margin: 16mm 14mm; }
  @media print { body { padding: 0; max-width: none; } h2 { break-after: avoid; } tr, dl { break-inside: avoid; } thead { display: table-header-group; } }
</style></head><body>
<h1>${h(r.title)}</h1>
<p class="meta">Org <b>${h(r.ctx.host)}</b> · data space <b>${h(r.ctx.dataspace)}</b> · generated ${h(stamp(r.ctx.at))}</p>
<p class="meta">Built from metadata and cached aggregates only; no queries were run to produce it.</p>
${r.gaps.length ? `<div class="gaps"><b>Not included</b><ul>${r.gaps.map((g) => `<li>${h(g)}</li>`).join('')}</ul></div>` : ''}
${body}
</body></html>
`;
}
