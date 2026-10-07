/**
 * Live-org smoke test for the Data 360 adapter. Run it on your own machine against a sandbox:
 *
 *   sf org login web --instance-url https://<mydomain> --client-id <consumer key>
 *   npm run smoke                       # uses `sf org display --json`
 *   SF_TARGET_ORG=my-alias npm run smoke
 *   SF_ACCESS_TOKEN=… SF_INSTANCE_URL=https://… npm run smoke
 *
 * It prints response shapes (HTTP status, JSON key names, column names/types, counts) and never
 * tokens or row values, so the output is safe to paste into an issue.
 */
import { execFileSync } from 'node:child_process';
import { buildDateHistogramSql, buildNumericHistogramSql, buildRangeSql, parseRange, chooseNumericBuckets, chooseDateUnit } from '../shared/histogram';
import { loadConfig } from '../server/config';
import { createConnectClient, type SessionHolder } from '../server/data360/client';
import { UpstreamError } from '../server/data360/types';
import { assertAllowedOrigin } from '../server/hosts';

function credentials(): { accessToken: string; instanceUrl: string } {
  if (process.env.SF_ACCESS_TOKEN && process.env.SF_INSTANCE_URL) {
    return { accessToken: process.env.SF_ACCESS_TOKEN, instanceUrl: process.env.SF_INSTANCE_URL };
  }
  const args = ['org', 'display', '--json', ...(process.env.SF_TARGET_ORG ? ['-o', process.env.SF_TARGET_ORG] : [])];
  const out = JSON.parse(execFileSync('sf', args, { encoding: 'utf8' })) as { result: { accessToken: string; instanceUrl: string } };
  return out.result;
}

const config = loadConfig({ SESSION_KEY: 'x'.repeat(40), SF_CLIENT_ID: 'smoke', ...process.env, NODE_ENV: 'development', DATA360_MOCK: '' });
const creds = credentials();
const instanceUrl = assertAllowedOrigin(creds.instanceUrl, config.allowedHostSuffixes);

/** Key names two levels down (first array item at each level); never values. */
const shapeDeep = (v: unknown, depth = 0): string => {
  if (Array.isArray(v)) return `[${v.length}${v.length && depth < 3 ? ` × ${shapeDeep(v[0], depth + 1)}` : ''}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    return `{${entries.map(([k, x]) => (depth < 3 && x && typeof x === 'object' ? `${k}:${shapeDeep(x, depth + 1)}` : k)).join(',')}}`;
  }
  return typeof v;
};

const shape = (v: unknown, depth = 0): string => {
  if (Array.isArray(v)) return `[${v.length}${v.length && depth < 1 ? ` × ${shape(v[0], depth + 1)}` : ''}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).join(',')}}`;
  return typeof v;
};

// Log every request the adapter makes (method, path, HTTP status, top-level JSON shape).
const loggingFetch = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  const u = new URL(url);
  let body = '';
  try {
    body = shape(JSON.parse(await res.clone().text()));
  } catch {
    body = '(no JSON body)';
  }
  console.log(`   ${init?.method ?? 'GET'} ${u.pathname.replace(/^\/services\/data\//, '')}${u.search.replace(/queryId=[^&]+/, '')} → ${res.status} ${body}`);
  return res;
};

const holder: SessionHolder = {
  current: { accessToken: creds.accessToken, instanceUrl, loginHost: 'https://login.salesforce.com', clientId: 'smoke' },
  refreshed: false,
};
const client = createConnectClient(config, loggingFetch, holder);

let failures = 0;
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  console.log(`\n▶ ${name}`);
  try {
    const r = await fn();
    console.log('   ✓ ok');
    return r;
  } catch (e) {
    failures++;
    console.log(`   ✗ ${e instanceof UpstreamError ? `HTTP ${e.status} ${e.code ?? ''}: ` : ''}${(e as Error).message}`);
    return undefined;
  }
}

console.log(`Data 360 smoke test against ${new URL(instanceUrl).host} (API ${config.apiVersion})`);

const spaces = await step('List data spaces', async () => {
  const s = await client.listDataSpaces();
  console.log(`   ${s.length} data space(s): ${s.map((d) => d.name).join(', ')}`);
  return s;
});
const dataspace = spaces?.some((s) => s.name === 'default') || !spaces?.length ? 'default' : spaces[0]!.name;

const meta = await step(`Read metadata (${dataspace})`, async () => {
  const m = await client.getMetadata(dataspace);
  const by = (k: string) => m.objects.filter((o) => o.kind === k).length;
  console.log(`   dmo=${by('dmo')} dlo=${by('dlo')} ci=${by('ci')} warnings=${m.warnings.length}`);
  for (const w of m.warnings) console.log(`   warning: ${w}`);
  const sample = m.objects.find((o) => o.kind === 'dmo' && o.fields.length) ?? m.objects[0];
  if (sample) {
    console.log(`   sample: ${sample.name} category=${sample.category} fields=${sample.fields.length} pk=${sample.primaryKeys.length} rel=${sample.relationships.length}`);
    console.log(`   field types seen: ${[...new Set(m.objects.flatMap((o) => o.fields.map((f) => f.type)))].join(', ')}`);
  }
  return m;
});

const target = meta?.objects.find((o) => o.kind === 'dmo' && o.fields.length) ?? meta?.objects.find((o) => o.fields.length);
if (!target) {
  console.log('\nNo queryable object found; skipping query steps.');
} else {
  const q = (n: number) => `SELECT * FROM "${target.name}" LIMIT ${n}`;
  const first = await step(`Submit query (rowLimit 2) on ${target.name}`, async () => {
    const r = await client.submitQuery({ sql: q(10), dataspace, params: [], rowLimit: 2 });
    console.log(`   done=${r.done} progress=${r.progress} rowCount=${r.rowCount} firstChunk=${r.rows.length} columns=${r.columns?.length ?? 0}`);
    console.log(`   column types: ${[...new Set((r.columns ?? []).map((c) => c.type))].join(', ')}`);
    return r;
  });
  if (first) {
    await step('Poll status (long poll 2s)', async () => {
      const s = await client.getStatus(first.queryId, dataspace, 2000);
      console.log(`   done=${s.done} progress=${s.progress} rowCount=${s.rowCount}`);
    });
    await step('Fetch rows at offset 2', async () => {
      const p = await client.getRows(first.queryId, dataspace, 2, 5);
      console.log(`   rows=${p.rows.length} hasMetadata=${Boolean(p.columns?.length)}`);
    });
  }
  await step('Parameterised query (Varchar param)', async () => {
    const field = target.fields.find((f) => f.type === 'STRING');
    if (!field) return console.log('   (no STRING field; skipped)');
    const r = await client.submitQuery({
      sql: `SELECT "${field.name}" FROM "${target.name}" WHERE "${field.name}" = :v LIMIT 1`,
      dataspace,
      params: [{ name: 'v', type: 'Varchar', value: '__no_such_value__' }],
    });
    console.log(`   accepted; rowCount=${r.rowCount}`);
  });
  await step('Cancel a query', async () => {
    const r = await client.submitQuery({ sql: q(10), dataspace, params: [], rowLimit: 1 });
    await client.cancel(r.queryId, dataspace);
  });
}

await step(`Data streams and segments (${dataspace})`, async () => {
  const x = await client.getExtras(dataspace);
  console.log(`   dataStreams=${x.dataStreams ? `${x.dataStreams.items.length}/${x.dataStreams.total}` : 'unavailable'} segments=${x.segments ? `${x.segments.items.length}${x.segments.truncated ? '+' : ''}` : 'unavailable'}`);
  const streams = x.dataStreams?.items ?? [];
  const segments = x.segments?.items ?? [];
  console.log(`   streams naming their DLO: ${streams.filter((s) => s.dataLakeObject).length}/${streams.length}`);
  // Credit seeding reads these; each is a guess at the key name until a real org confirms it.
  const has = (k: 'connectorType' | 'refreshMode' | 'refreshFrequency' | 'lastRunRecords') => `${streams.filter((s) => s[k] !== undefined).length}/${streams.length}`;
  console.log(`   streams with connectorType ${has('connectorType')}, refreshMode ${has('refreshMode')}, refreshFrequency ${has('refreshFrequency')}, lastRunRecords ${has('lastRunRecords')}`);
  console.log(`   connector types: ${[...new Set(streams.map((s) => s.connectorType ?? '?'))].join(', ')}; refresh modes: ${[...new Set(streams.map((s) => s.refreshMode ?? '?'))].join(', ')}`);
  console.log(`   segments with include criteria: ${segments.filter((s) => s.includeCriteria).length}/${segments.length}; with exclude: ${segments.filter((s) => s.excludeCriteria).length}`);
  const sample = segments.find((s) => s.includeCriteria)?.includeCriteria;
  if (sample) console.log(`   include criteria is ${(() => { try { return `JSON ${shapeDeep(JSON.parse(sample))}`; } catch { return 'not JSON'; } })()}`);
  for (const e of x.errors) throw new Error(e);
});

// Mapping/lineage (#9), insight definitions (#10) and identity resolution (#11) were written from the
// spec's schemas and examples. These print key names so the normalizers can be checked against what ships.
const authedGet = (path: string) =>
  loggingFetch(`${instanceUrl}/services/data/${config.apiVersion}/ssot${path}`, {
    headers: { authorization: `Bearer ${creds.accessToken}`, accept: 'application/json' },
  });

const dmo = meta?.objects.find((o) => o.kind === 'dmo' && o.category === 'Profile') ?? meta?.objects.find((o) => o.kind === 'dmo');
if (dmo) {
  const maps = await step(`Mappings into ${dmo.name}`, async () => {
    const m = await client.getMappings(dataspace, dmo.name);
    console.log(`   raw: ${shapeDeep(m.raw)}`);
    console.log(`   normalized: ${m.mappings.length} mapping(s), ${m.mappings.reduce((n, x) => n + x.fields.length, 0)} field pair(s)`);
    const src = m.mappings[0]?.source;
    if (src && meta?.objects.some((o) => o.name === src)) console.log('   source names match metadata names');
    else if (src) console.log(`   source "${src}" is not a metadata object name: check suffixes (__dll)`);
    return m;
  });
  const first = maps?.mappings[0];
  if (first) {
    await step(`Mappings into ${dmo.name}, narrowed to ${first.source}`, async () => {
      const m = await client.getMappings(dataspace, dmo.name, first.source);
      console.log(`   normalized: ${m.mappings.length} mapping(s) (expected at least 1, all from ${first.source}: ${m.mappings.every((x) => x.source === first.source)})`);
    });
  }
  // The spec marks dmoDeveloperName as required, so there is no lookup by DLO alone. Confirm.
  await step('Mappings without a DMO (expected to be rejected)', async () => {
    const res = await authedGet(`/data-model-object-mappings?dataspace=${dataspace}`);
    console.log(`   HTTP ${res.status} (expected 400: the spec marks dmoDeveloperName required)`);
  });
}
const insight = meta?.objects.find((o) => o.kind === 'ci');
if (insight) {
  await step(`Calculated insight definition ${insight.name}`, async () => {
    const d = await client.getCalculatedInsight(insight.name);
    console.log(`   raw: ${shapeDeep(d.raw)}`);
    console.log(`   normalized: expression=${Boolean(d.expression)} status=${d.status ?? '-'} lastRunAt=${d.lastRunAt ?? '-'} dims=${d.dimensions.length} measures=${d.measures.length} formulas=${[...d.dimensions, ...d.measures].filter((f) => f.formula).length}`);
  });
}

await step('Identity resolution rulesets (/ssot/identity-resolutions)', async () => {
  const res = await authedGet('/identity-resolutions');
  const body = (await res.json().catch(() => ({}))) as { identityResolutions?: Record<string, unknown>[] };
  const sets = body.identityResolutions ?? [];
  console.log(`   rulesets=${sets.length}`);
  const names = new Set(meta?.objects.map((o) => o.name));
  for (const r of sets) {
    console.log(`   - status=${String(r.rulesetStatus)} lastJob=${String(r.lastJobStatus)} sourceProfiles=${String(r.sourceProfiles)} unified=${String(r.totalUnifiedProfiles)} consolidationRate=${String(r.consolidationRate)}`);
    for (const rr of (r.reconciliationRules ?? []) as { entityName?: string; linkDmoName?: string; unifiedDmoName?: string }[]) {
      const seen = (n?: string) => (n ? (names.has(n) ? 'in metadata' : 'NOT in metadata') : '-');
      console.log(`     ${rr.entityName}: link=${rr.linkDmoName} (${seen(rr.linkDmoName)}) unified=${rr.unifiedDmoName} (${seen(rr.unifiedDmoName)})`);
    }
  }
  // The library's identity queries assume the default names; a ruleset using others needs them edited.
  const link = meta?.objects.find((o) => o.name === 'IndividualIdentityLink__dlm');
  console.log(`   library queries assume IndividualIdentityLink__dlm: ${link ? 'found' : 'MISSING'}${link ? `; columns: ${link.fields.map((f) => f.name).join(', ')}` : ''}`);
  const need = ['SourceRecordId__c', 'KQ_SourceRecordId__c', 'UnifiedRecordId__c'];
  if (link) console.log(`   needed columns present: ${need.map((c) => `${c}=${link.fields.some((f) => f.name === c)}`).join(' ')}`);
  console.log(`   UnifiedIndividual__dlm: ${names.has('UnifiedIndividual__dlm') ? 'found' : 'MISSING'}`);
});

// Histograms rely on FLOOR(...) and DATE_TRUNC(...) in Data 360 SQL; confirm both are accepted.
if (target) {
  for (const [label, types] of [['numeric', ['NUMBER']], ['date', ['DATE', 'DATE_TIME']]] as [string, string[]][]) {
    const field = target.fields.find((f) => types.includes(f.type));
    if (!field) {
      console.log(`\n▶ Histogram (${label}): skipped, ${target.name} has no ${label} field`);
      continue;
    }
    await step(`Histogram (${label}) on ${target.name}.${field.name}`, async () => {
      const run = async (sql: string) => {
        const r = await client.submitQuery({ sql, dataspace, params: [] });
        // Aggregates return few rows, so the first chunk is the whole result.
        return r.rows;
      };
      const range = parseRange((await run(buildRangeSql(target, field.name)))[0] ?? []);
      console.log(`   non-null=${range.nonNull} total=${range.total} min/max types=${typeof range.min}/${typeof range.max}`);
      if (range.nonNull === 0) return console.log('   (no values; skipped the bucket query)');
      const sql = label === 'numeric'
        ? buildNumericHistogramSql(target, field.name, chooseNumericBuckets(Number(range.min), Number(range.max)))
        : buildDateHistogramSql(target, field.name, chooseDateUnit(range.min, range.max));
      const rows = await run(sql);
      console.log(`   buckets returned=${rows.length}; first bucket value type=${typeof rows[0]?.[0]}`);
    });
  }
}

console.log(`\n${failures ? `✗ ${failures} step(s) failed` : '✓ all steps passed'}`);
process.exit(failures ? 1 : 0);
