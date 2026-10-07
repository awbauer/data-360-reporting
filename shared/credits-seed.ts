// Starts a credit plan from what the connected org already has: data streams, identity resolution,
// calculated insights and segments. Uses only metadata, list responses and row counts the browser
// cached earlier, so it runs no queries. Every item says how its numbers were arrived at; most are
// assumptions for the consultant to confirm, and the picker shows them before anything is added.
import { DAILY, FREQUENCIES, newItem, type ActivityKind, type PlanItem } from './credits';
import type { Extras, InsightDefinition, ObjectMeta, StreamInfo } from './types';

export interface SeedInput {
  objects: ObjectMeta[];
  extras: Extras | null;
  /** Definitions fetched for the org's calculated insights (any that failed are just missing). */
  insights: InsightDefinition[];
  /** Cached row counts, by object name. */
  counts: Record<string, { rows: number; at: string }>;
  /** Share of rows assumed new or changed per incremental run. */
  changeRate: number;
  newId: () => string;
}

export interface SeedCandidate {
  group: 'Data streams' | 'Identity resolution' | 'Calculated insights' | 'Segments' | 'Activations';
  item: PlanItem;
  /** Something the estimate depends on is unknown (a missing row count), so it starts unticked. */
  incomplete: boolean;
}

const freq = (id: string) => FREQUENCIES.find((f) => f.id === id)!.runs;
const n = (x: number) => Math.round(x).toLocaleString('en-US');
const pctText = (x: number) => `${Math.round(x * 1000) / 10}%`;

const INTERNAL = /salesforce|sfdc|crm|marketing.?cloud|commerce.?cloud|personali[sz]ation|sales.?cloud|service.?cloud/i;
const STREAMING = /sdk|website|mobile|web.?event|stream|real.?time/i;

/** Ingestion activity for a stream: from its connector type when the API gave one, else its name. */
export function classifyStream(s: StreamInfo): { kind: ActivityKind; basis: string } {
  const text = s.connectorType ?? `${s.name} ${s.label}`;
  const basis = s.connectorType ? `connector ${s.connectorType}` : 'the stream’s name (the API gave no connector type)';
  if (INTERNAL.test(text)) return { kind: 'ingest_internal', basis };
  if (STREAMING.test(text)) return { kind: 'ingest_streaming', basis };
  return { kind: 'ingest_batch', basis };
}

function refreshRuns(frequency: string | undefined): { runs: number; known: boolean } {
  const f = frequency ?? '';
  if (/15/.test(f)) return { runs: freq('15m'), known: true };
  if (/hour/i.test(f)) return { runs: freq('1h'), known: true };
  if (/week/i.test(f)) return { runs: freq('weekly'), known: true };
  if (/month/i.test(f)) return { runs: freq('monthly'), known: true };
  if (/day|daily/i.test(f)) return { runs: DAILY, known: true };
  return { runs: DAILY, known: false };
}

/** `publishScheduleInterval` values seen in the spec: ONE, SIX, TWELVE, TWENTY_FOUR (hours). */
function insightRuns(schedule: string | undefined): { runs: number; known: boolean } {
  const hours: Record<string, number> = { ONE: 1, SIX: 6, TWELVE: 12, TWENTY_FOUR: 24 };
  const h = hours[(schedule ?? '').toUpperCase()];
  return h ? { runs: (DAILY * 24) / h, known: true } : { runs: DAILY, known: false };
}

/** Object API names an expression or criteria text mentions, among the org's objects. */
export function objectsMentioned(text: string, objects: ObjectMeta[]): string[] {
  const names = new Set(text.match(/[A-Za-z][A-Za-z0-9_]*__(?:dlm|dll|cio)\b/g) ?? []);
  return objects.filter((o) => names.has(o.name)).map((o) => o.name);
}

/** Total cached rows for `names`, and which of them have no cached count. */
function rowsOf(names: string[], counts: SeedInput['counts']): { rows: number; missing: string[]; parts: string } {
  const missing = names.filter((x) => !counts[x]);
  const known = names.filter((x) => counts[x]);
  return {
    rows: known.reduce((t, x) => t + counts[x]!.rows, 0),
    missing,
    parts: known.map((x) => `${x} (${n(counts[x]!.rows)})`).join(', '),
  };
}

const COUNT_FIRST = 'Count rows on the Overview page first, or enter the volume.';

export function seedCandidates(input: SeedInput): SeedCandidate[] {
  const { objects, counts, changeRate, newId } = input;
  const out: SeedCandidate[] = [];
  const byName = new Map(objects.map((o) => [o.name, o]));

  // Data streams. Seeded for a running org: initial loads are done, so only refreshes count.
  for (const s of input.extras?.dataStreams?.items ?? []) {
    const { kind, basis } = classifyStream(s);
    const a: string[] = [`Classified as ${kind === 'ingest_internal' ? 'a native Salesforce connector' : kind === 'ingest_streaming' ? 'streaming' : 'external batch'} from ${basis}.`];
    let perRun = 0;
    let incomplete = false;
    if (kind === 'ingest_internal') {
      a.push('No credits either way; listed so the plan is complete.');
      perRun = s.lastRunRecords ?? s.totalRecords ?? 0;
    } else if (s.lastRunRecords !== undefined) {
      perRun = s.lastRunRecords;
      a.push(`Rows per ${kind === 'ingest_streaming' ? 'day' : 'run'}: the last run processed ${n(s.lastRunRecords)}.`);
    } else if (s.totalRecords !== undefined) {
      const full = /full/i.test(s.refreshMode ?? '');
      perRun = full ? s.totalRecords : s.totalRecords * changeRate;
      a.push(full
        ? `Full refresh: every run reprocesses all ${n(s.totalRecords)} records.`
        : `Assumes ${pctText(changeRate)} of the stream’s ${n(s.totalRecords)} records change per ${kind === 'ingest_streaming' ? 'day' : 'run'}${s.refreshMode ? ` (${s.refreshMode})` : ''}.`);
    } else {
      incomplete = true;
      a.push('The API gave no record count; enter the volume.');
    }
    const runs = kind === 'ingest_streaming' ? { runs: DAILY, known: true } : refreshRuns(s.refreshFrequency);
    if (!runs.known) a.push('Refresh schedule unknown; assumed daily.');
    out.push({
      group: 'Data streams',
      incomplete,
      item: newItem(kind, newId(), { label: s.label, perRun: Math.round(perRun), runsPerMonth: runs.runs, assumption: a.join(' '), source: `Data stream ${s.name}` }),
    });
  }

  // Identity resolution: present when the org has unified individuals. Source profiles are the
  // individuals linked into them; only new or changed ones count after the first run.
  if (objects.some((o) => /^UnifiedIndividual/i.test(o.name))) {
    const src = ['IndividualIdentityLink__dlm', 'ssot__Individual__dlm'].find((x) => counts[x] && byName.has(x));
    const rows = src ? counts[src]!.rows : 0;
    out.push({
      group: 'Identity resolution',
      incomplete: !src,
      item: newItem('unification', newId(), {
        label: 'Individual identity resolution',
        perRun: Math.round(rows * changeRate),
        runsPerMonth: DAILY,
        assumption: src
          ? `${n(rows)} source profiles (${src}); assumes ${pctText(changeRate)} are new or changed per daily run. Rerunning a ruleset from scratch counts every source profile again: add that as a one-time volume.`
          : `No cached count for the source profiles. ${COUNT_FIRST}`,
        source: 'Identity resolution',
      }),
    });
  }

  // Calculated insights: every run reads all rows of the objects its SQL reads.
  const defs = new Map(input.insights.map((d) => [d.name, d]));
  for (const o of objects.filter((x) => x.kind === 'ci')) {
    const d = defs.get(o.name);
    const reads = d?.expression ? objectsMentioned(d.expression, objects).filter((x) => x !== o.name) : [];
    const r = rowsOf(reads, counts);
    const runs = insightRuns(d?.schedule);
    const streaming = /stream/i.test(d?.definitionType ?? '');
    const a: string[] = [];
    if (!d?.expression) a.push('The definition wasn’t available, so the objects it reads are unknown; enter the rows it reads.');
    else if (!reads.length) a.push('Could not tell which objects the SQL reads; enter the rows it reads.');
    else {
      if (r.parts) a.push(`Reads ${r.parts}.`);
      if (r.missing.length) a.push(`No cached count for ${r.missing.join(', ')}. ${COUNT_FIRST}`);
    }
    if (!runs.known) a.push(`Schedule ${d?.schedule ? `“${d.schedule}”` : 'unknown'}; assumed daily.`);
    out.push({
      group: 'Calculated insights',
      incomplete: !reads.length || r.missing.length > 0,
      item: newItem(streaming ? 'ci_streaming' : 'ci_batch', newId(), {
        label: o.label,
        perRun: r.rows,
        runsPerMonth: streaming ? DAILY : runs.runs,
        assumption: a.join(' '),
        source: `Calculated insight ${o.name}`,
      }),
    });
  }

  // Segments: each refresh reads every row of the objects it uses, whatever the member count.
  for (const s of input.extras?.segments?.items ?? []) {
    if (/inactive|disabled/i.test(s.status ?? '')) continue;
    const reads = [...new Set([
      ...(s.segmentOn && byName.has(s.segmentOn) ? [s.segmentOn] : []),
      ...objectsMentioned(`${s.includeCriteria ?? ''} ${s.excludeCriteria ?? ''}`, objects),
    ])];
    const r = rowsOf(reads, counts);
    const a = [
      reads.length ? `Reads ${[r.parts, ...r.missing.map((x) => `${x} (not counted)`)].filter(Boolean).join(', ')}.` : 'Could not tell which objects it reads; enter the rows it reads.',
      'Refresh schedule isn’t in the API; assumed daily.',
      ...(r.missing.length ? [COUNT_FIRST] : []),
    ];
    out.push({
      group: 'Segments',
      incomplete: !reads.length || r.missing.length > 0,
      item: newItem('segmentation', newId(), { label: s.label, perRun: r.rows, runsPerMonth: DAILY, assumption: a.join(' '), source: `Segment ${s.apiName}` }),
    });
    if (/success/i.test(s.publishStatus ?? '') && s.lastMemberCount !== undefined) {
      out.push({
        group: 'Activations',
        incomplete: false,
        item: newItem('activation_batch', newId(), {
          label: `${s.label} activation`,
          perRun: s.lastMemberCount,
          runsPerMonth: DAILY,
          assumption: `Assumes one activation of the last published ${n(s.lastMemberCount)} members per daily refresh; add related attribute rows if it sends them.`,
          source: `Segment ${s.apiName}`,
        }),
      });
    }
  }
  return out;
}
