import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from 'node:sqlite';
import { DATE_UNITS, parseTimestamp, truncate, type DateUnit } from '../../../shared/histogram';
import type { CellValue, Extras, QueryColumn } from '../../../shared/types';
import { normalizeDataSpaces, normalizeInsight, normalizeMappings, normalizeMetadata } from '../normalize';
import { UpstreamError, type Data360Client } from '../types';
import { DATA_SPACES, INSIGHTS, MAPPINGS, MARKETING_OBJECTS, METADATA } from './fixtures';

// Loaded via require: Vite/Vitest don't recognise the newer `node:sqlite` builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

const API_TO_SQLITE: Record<string, (v: string) => SQLInputValue> = {
  BigInt: (v) => Number(v),
  Integer: (v) => Number(v),
  SmallInt: (v) => Number(v),
  Double: (v) => Number(v),
  Float: (v) => Number(v),
  Numeric: (v) => Number(v),
  Bool: (v) => (v === 'true' ? 1 : 0),
};

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ada', 'Grace', 'Alan', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Tim'];
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov', 'Thompson', 'Perlman', 'Berners-Lee'];
const INDUSTRY = ['Retail', 'Finance', 'Healthcare', 'Media', 'Travel'];
const SOURCES = ['Salesforce_CRM', 'Web_SDK', 'Ecommerce'];

function seed(db: DatabaseSync): void {
  const rnd = mulberry32(42);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const maybe = <T>(p: number, v: T) => (rnd() < p ? null : v);
  const date = () => new Date(Date.UTC(2023, 0, 1) + Math.floor(rnd() * 900) * 86_400_000).toISOString();
  const ins = (table: string, cols: string[], rows: unknown[][]) => {
    const q = cols.map((c) => `"${c}"`).join(',');
    const stmt = db.prepare(`INSERT INTO "${table}" (${q}) VALUES (${cols.map(() => '?').join(',')})`);
    db.exec('BEGIN');
    for (const r of rows) stmt.run(...(r as SQLInputValue[]));
    db.exec('COMMIT');
  };
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  db.exec(`
    CREATE TABLE "ssot__Individual__dlm" ("ssot__Id__c" TEXT, "KQ_Id__c" TEXT, "ssot__FirstName__c" TEXT, "ssot__LastName__c" TEXT,
      "ssot__BirthDate__c" TEXT, "ssot__YearlyIncome__c" REAL, "ssot__DataSourceId__c" TEXT, "ssot__CreatedDate__c" TEXT);
    CREATE TABLE "ssot__ContactPointEmail__dlm" ("ssot__Id__c" TEXT, "KQ_Id__c" TEXT, "ssot__PartyId__c" TEXT, "KQ_PartyId__c" TEXT,
      "ssot__EmailAddress__c" TEXT, "ssot__CreatedDate__c" TEXT);
    CREATE TABLE "ssot__Account__dlm" ("ssot__Id__c" TEXT, "KQ_Id__c" TEXT, "ssot__Name__c" TEXT, "ssot__Industry__c" TEXT,
      "ssot__AnnualRevenue__c" REAL, "ssot__CreatedDate__c" TEXT);
    CREATE TABLE "ssot__EmailEngagement__dlm" ("ssot__Id__c" TEXT, "ssot__IndividualId__c" TEXT, "ssot__EngagementType__c" TEXT,
      "ssot__EngagementDateTime__c" TEXT);
    CREATE TABLE "ssot__Case__dlm" ("ssot__Id__c" TEXT, "ssot__Subject__c" TEXT);
    CREATE TABLE "Contact_Home__dll" ("Id__c" TEXT, "Email__c" TEXT, "Score__c" REAL, "ModifiedDate__c" TEXT);
    CREATE TABLE "Avg_Spends__cio" ("Id__c" TEXT, "FirstName__c" TEXT, "Avg_Spend__c" REAL);
  `);

  const people = range(2500).map((i) => {
    const first = pick(FIRST);
    return [`IND-${String(i).padStart(5, '0')}`, `KQ${i}`, maybe(0.05, first), pick(LAST), maybe(0.2, date()),
      maybe(0.3, Math.round(30_000 + rnd() * 120_000)), pick(SOURCES), date()];
  });
  ins('ssot__Individual__dlm', ['ssot__Id__c', 'KQ_Id__c', 'ssot__FirstName__c', 'ssot__LastName__c', 'ssot__BirthDate__c',
    'ssot__YearlyIncome__c', 'ssot__DataSourceId__c', 'ssot__CreatedDate__c'], people);
  ins('ssot__ContactPointEmail__dlm', ['ssot__Id__c', 'KQ_Id__c', 'ssot__PartyId__c', 'KQ_PartyId__c', 'ssot__EmailAddress__c', 'ssot__CreatedDate__c'],
    range(3000).map((i) => {
      const p = people[Math.floor(rnd() * people.length)]!;
      return [`EM-${i}`, `KQE${i}`, p[0], p[1], maybe(0.02, `${String(p[2] ?? 'user').toLowerCase()}${i}@example.com`), date()];
    }));
  ins('ssot__Account__dlm', ['ssot__Id__c', 'KQ_Id__c', 'ssot__Name__c', 'ssot__Industry__c', 'ssot__AnnualRevenue__c', 'ssot__CreatedDate__c'],
    range(400).map((i) => [`ACC-${i}`, `KQA${i}`, `Account ${i}`, maybe(0.1, pick(INDUSTRY)), Math.round(rnd() * 5_000_000), date()]));
  ins('ssot__EmailEngagement__dlm', ['ssot__Id__c', 'ssot__IndividualId__c', 'ssot__EngagementType__c', 'ssot__EngagementDateTime__c'],
    range(5000).map((i) => [`ENG-${i}`, people[Math.floor(rnd() * people.length)]![0], pick(['Open', 'Click', 'Bounce', 'Unsubscribe']), date()]));
  ins('ssot__Case__dlm', ['ssot__Id__c', 'ssot__Subject__c'], range(120).map((i) => [`CASE-${i}`, `Issue ${i}`]));
  ins('Contact_Home__dll', ['Id__c', 'Email__c', 'Score__c', 'ModifiedDate__c'],
    range(1200).map((i) => [`C-${i}`, maybe(0.1, `contact${i}@example.com`), Math.round(rnd() * 100), date()]));
  seedIdentity(db, people as unknown[][]);
  ins('Avg_Spends__cio', ['Id__c', 'FirstName__c', 'Avg_Spend__c'],
    range(50).map((i) => [`IND-${String(i).padStart(5, '0')}`, pick(FIRST), Math.round(rnd() * 50_000) / 100]));
}

/** Unified profiles: individuals grouped into clusters of 1–5 (mostly 1–2), with their own RNG. */
function seedIdentity(db: DatabaseSync, people: unknown[][]): void {
  const rnd = mulberry32(7);
  db.exec(`
    CREATE TABLE "UnifiedIndividual__dlm" ("ssot__Id__c" TEXT, "ssot__FirstName__c" TEXT, "ssot__LastName__c" TEXT);
    CREATE TABLE "IndividualIdentityLink__dlm" ("SourceRecordId__c" TEXT, "KQ_SourceRecordId__c" TEXT, "UnifiedRecordId__c" TEXT);
  `);
  const unified = db.prepare('INSERT INTO "UnifiedIndividual__dlm" VALUES (?, ?, ?)');
  const link = db.prepare('INSERT INTO "IndividualIdentityLink__dlm" VALUES (?, ?, ?)');
  db.exec('BEGIN');
  let i = 0;
  let u = 0;
  while (i < people.length) {
    const r = rnd();
    const size = r < 0.55 ? 1 : r < 0.85 ? 2 : r < 0.95 ? 3 : r < 0.99 ? 4 : 5;
    const id = `UNI-${String(u++).padStart(5, '0')}`;
    const head = people[i]!;
    unified.run(id, head[2] as SQLInputValue, head[3] as SQLInputValue);
    for (const p of people.slice(i, i + size)) link.run(p[0] as SQLInputValue, p[1] as SQLInputValue, id);
    i += size;
  }
  db.exec('COMMIT');
}

function columnType(v: CellValue): string {
  if (typeof v === 'number') return Number.isInteger(v) ? 'BigInt' : 'Double';
  if (typeof v === 'boolean') return 'Bool';
  return 'Varchar';
}

interface Stored {
  columns: QueryColumn[];
  rows: CellValue[][];
  polls: number;
}

/** Slow-path threshold: results larger than this report `Running` for a couple of polls. */
const SLOW_ROWS = 2000;

export function createMockClient(): Data360Client {
  const db = new DatabaseSync(':memory:');
  // node:sqlite types the accumulator as an SQL value, but any JS value works at runtime.
  db.aggregate('APPROX_COUNT_DISTINCT', {
    start: () => new Set<unknown>(),
    step: (set: Set<unknown>, v: unknown) => {
      if (v !== null && v !== undefined) set.add(v);
      return set;
    },
    result: (set: Set<unknown>) => set.size,
  } as never);
  // Hyper's date_trunc(unit, ts): returns an ISO timestamp with offset, like Data 360 does.
  db.function('DATE_TRUNC', (unit: unknown, ts: unknown) => {
    if (ts === null || ts === undefined || !DATE_UNITS.includes(unit as DateUnit)) return null;
    const t = parseTimestamp(ts);
    return Number.isFinite(t) ? new Date(truncate(t, unit as DateUnit)).toISOString().replace('.000Z', '+00:00') : null;
  });
  seed(db);
  const queries = new Map<string, Stored>();

  const get = (id: string): Stored => {
    const q = queries.get(id);
    if (!q) throw new UpstreamError(404, `Query ${id} not found or expired`);
    return q;
  };
  const status = (id: string, q: Stored) => {
    const done = q.rows.length <= SLOW_ROWS || q.polls >= 2;
    return { queryId: id, done, progress: done ? 1 : q.polls === 0 ? 0.1 : 0.6, rowCount: q.rows.length };
  };

  return {
    async listDataSpaces() {
      return normalizeDataSpaces(DATA_SPACES);
    },

    async getMetadata(dataspace) {
      if (!DATA_SPACES.dataSpaces.some((d) => d.name === dataspace)) {
        throw new UpstreamError(404, `Data space ${dataspace} not found`);
      }
      const objects = [
        ...normalizeMetadata(METADATA.DataModelObject, 'dmo'),
        ...normalizeMetadata(METADATA.DataLakeObject, 'dlo'),
        ...normalizeMetadata(METADATA.CalculatedInsight, 'ci'),
      ].filter((o) => dataspace === 'default' || MARKETING_OBJECTS.has(o.name));
      return { objects, warnings: [] };
    },

    async getExtras(dataspace): Promise<Extras> {
      const streams = [
        {
          name: 'Salesforce_CRM_Contact', label: 'Salesforce CRM Contact', status: 'ACTIVE', lastRunStatus: 'SUCCESS', lastRefreshDate: '2026-10-05T04:10:00Z',
          totalRecords: 2500, dataLakeObject: 'Contact_Home__dll', connectorType: 'SalesforceDotCom', refreshMode: 'UPSERT', refreshFrequency: 'HOURLY',
        },
        { name: 'Web_SDK_Events', label: 'Web SDK Events', status: 'ACTIVE', lastRunStatus: 'SUCCESS', lastRefreshDate: '2026-10-06T01:00:00Z', totalRecords: 5000, connectorType: 'Website' },
        {
          name: 'Ecommerce_Orders', label: 'Ecommerce Orders', status: 'ACTIVE', lastRunStatus: 'FAILED', lastRefreshDate: '2026-10-03T22:30:00Z',
          totalRecords: 1200, connectorType: 'S3', refreshMode: 'FULL_REFRESH', refreshFrequency: 'DAILY', lastRunRecords: 1200,
        },
      ];
      const segments = [
        {
          apiName: 'Lapsed_VIPs', label: 'Lapsed VIPs', status: 'ACTIVE', publishStatus: 'PUBLISH_SUCCESS', lastMemberCount: 312,
          lastPublished: '2026-10-05T12:00:00Z', description: 'High earners with no email engagement in 90 days.', segmentOn: 'UnifiedIndividual__dlm',
          segmentType: 'UI', publishInterval: 'DAILY', nextPublish: '2026-10-08T06:00:00Z',
          includeCriteria: JSON.stringify({ filters: [{ object: 'ssot__Individual__dlm', field: 'ssot__YearlyIncome__c', operator: 'greaterThan', value: '100000' }] }),
          excludeCriteria: JSON.stringify({ filters: [{ object: 'ssot__EmailEngagement__dlm', field: 'ssot__EngagementDateTime__c', operator: 'lastNDays', value: '90' }] }),
        },
        { apiName: 'New_Subscribers', label: 'New Subscribers', status: 'ACTIVE', publishStatus: 'PUBLISH_SUCCESS', lastMemberCount: 1840, lastPublished: '2026-10-06T06:00:00Z' },
        { apiName: 'Draft_Test', label: 'Draft Test', status: 'INACTIVE' },
      ];
      return {
        dataStreams: { total: streams.length, truncated: false, items: streams },
        segments: dataspace === 'default' ? { total: segments.length, truncated: false, items: segments } : { total: 1, truncated: false, items: segments.slice(1, 2) },
        errors: [],
      };
    },

    async getMappings(_dataspace, dmo, dlo) {
      // Like the real API: the DMO is required, the DLO only narrows the result.
      if (!dmo) throw new UpstreamError(400, 'Required query parameter dmoDeveloperName is missing', 'REQUIRED_QUERY_PARAMETER_MISSING');
      const raw = {
        objectSourceTargetMaps: MAPPINGS.objectSourceTargetMaps.filter(
          (m) => m.targetEntityDeveloperName === dmo && (!dlo || m.sourceEntityDeveloperName === dlo),
        ),
      };
      return normalizeMappings(raw);
    },

    async getCalculatedInsight(name) {
      const raw = INSIGHTS[name];
      if (!raw) throw new UpstreamError(404, `Calculated insight ${name} not found`, 'NOT_FOUND');
      return normalizeInsight(raw, name);
    },

    async submitQuery({ sql, params, rowLimit }) {
      if (!/^\s*(select|with)\b/i.test(sql)) throw new UpstreamError(400, 'Only SELECT statements are supported');
      const bound: Record<string, SQLInputValue> = {};
      for (const p of params) bound[p.name] = (API_TO_SQLITE[p.type] ?? ((v: string) => v))(p.value);
      let rows: CellValue[][];
      let names: string[];
      try {
        const stmt = db.prepare(sql);
        stmt.setReturnArrays(true);
        names = stmt.columns().map((c) => c.name);
        rows = stmt.all(bound) as unknown as CellValue[][]; // setReturnArrays(true)
      } catch (e) {
        throw new UpstreamError(400, (e as Error).message, '42601');
      }
      const first = rows[0];
      const columns = names.map((name, i) => ({ name, type: first ? columnType(first[i] ?? null) : 'Varchar', nullable: true }));
      const queryId = `bW9jaw%2F${randomUUID()}`;
      const stored: Stored = { columns, rows, polls: 0 };
      queries.set(queryId, stored);
      if (queries.size > 100) queries.delete(queries.keys().next().value!);
      const st = status(queryId, stored);
      return { ...st, columns, rows: rows.slice(0, rowLimit ?? 1000) };
    },

    async getStatus(queryId) {
      const q = get(queryId);
      const st = status(queryId, q);
      q.polls++;
      return st;
    },

    async getRows(queryId, _dataspace, offset, limit) {
      const q = get(queryId);
      if (!status(queryId, q).done) throw new UpstreamError(400, 'Query is still running');
      return { columns: q.columns, rows: q.rows.slice(offset, offset + limit) };
    },

    async cancel(queryId) {
      queries.delete(queryId);
    },
  };
}
