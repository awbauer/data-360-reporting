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

console.log(`\n${failures ? `✗ ${failures} step(s) failed` : '✓ all steps passed'}`);
process.exit(failures ? 1 : 0);
