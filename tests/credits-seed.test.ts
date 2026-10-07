import { beforeAll, describe, expect, it } from 'vitest';
import { DAILY, FREQUENCIES } from '../shared/credits';
import { classifyStream, objectsMentioned, seedCandidates, type SeedCandidate } from '../shared/credits-seed';
import { normalizeStreams } from '../server/data360/normalize';
import { createMockClient } from '../server/data360/mock/client';
import type { Extras, InsightDefinition, ObjectMeta } from '../shared/types';

const client = createMockClient();
let objects: ObjectMeta[];
let extras: Extras;
let insights: InsightDefinition[];
let n = 0;
const base = () => ({ objects, extras, insights, changeRate: 0.05, newId: () => `s${++n}` });
const counts = {
  ssot__Individual__dlm: { rows: 2_500, at: '2026-10-06T00:00:00Z' },
  IndividualIdentityLink__dlm: { rows: 2_500, at: '2026-10-06T00:00:00Z' },
  ssot__EmailEngagement__dlm: { rows: 5_000, at: '2026-10-06T00:00:00Z' },
  UnifiedIndividual__dlm: { rows: 1_600, at: '2026-10-06T00:00:00Z' },
};

beforeAll(async () => {
  objects = (await client.getMetadata('default')).objects;
  extras = await client.getExtras('default');
  insights = [await client.getCalculatedInsight('Avg_Spends__cio')];
});

const find = (c: SeedCandidate[], source: string) => c.find((x) => x.item.source === source)!;

describe('seeding a plan from the org', () => {
  it('classifies streams by connector type, falling back to the name', () => {
    expect(classifyStream({ name: 'x', label: 'x', connectorType: 'SalesforceDotCom' }).kind).toBe('ingest_internal');
    expect(classifyStream({ name: 'x', label: 'x', connectorType: 'MobileApp' }).kind).toBe('ingest_streaming');
    expect(classifyStream({ name: 'Orders', label: 'Orders', connectorType: 'S3' }).kind).toBe('ingest_batch');
    const byName = classifyStream({ name: 'Marketing_Cloud_Sends', label: 'MC sends' });
    expect(byName).toEqual({ kind: 'ingest_internal', basis: expect.stringMatching(/name/) });
  });

  it('turns streams into ingestion with stated assumptions', () => {
    const c = seedCandidates({ ...base(), counts });
    const crm = find(c, 'Data stream Salesforce_CRM_Contact');
    expect(crm.item.kind).toBe('ingest_internal');
    expect(crm.item.runsPerMonth).toBe(FREQUENCIES.find((f) => f.id === '1h')!.runs);
    const web = find(c, 'Data stream Web_SDK_Events');
    expect(web.item.kind).toBe('ingest_streaming');
    expect(web.item.perRun).toBe(250); // 5% of 5,000 per day
    expect(web.item.assumption).toMatch(/Assumes 5% of the stream’s 5,000 records change per day/);
    const orders = find(c, 'Data stream Ecommerce_Orders');
    expect(orders.item).toMatchObject({ kind: 'ingest_batch', perRun: 1_200, runsPerMonth: DAILY });
    expect(orders.item.assumption).toMatch(/last run processed 1,200/);
  });

  it('sizes identity resolution from cached source profiles, or leaves it unticked without them', () => {
    const c = seedCandidates({ ...base(), counts });
    const ir = c.find((x) => x.group === 'Identity resolution')!;
    expect(ir.item).toMatchObject({ kind: 'unification', perRun: 125, runsPerMonth: DAILY });
    expect(ir.incomplete).toBe(false);
    const none = seedCandidates({ ...base(), counts: {} }).find((x) => x.group === 'Identity resolution')!;
    expect(none.incomplete).toBe(true);
    expect(none.item.assumption).toMatch(/Count rows on the Overview page/);
  });

  it('sizes calculated insights from the objects their SQL reads and their schedule', () => {
    const c = seedCandidates({ ...base(), counts });
    const ci = find(c, 'Calculated insight Avg_Spends__cio');
    // The fixture's SQL reads SalesOrder__dlm (not in this org's metadata) and ssot__Individual__dlm.
    expect(ci.item).toMatchObject({ kind: 'ci_batch', perRun: 2_500, runsPerMonth: DAILY });
    expect(ci.item.assumption).toMatch(/Reads ssot__Individual__dlm \(2,500\)/);
    // The fixture insight is NOT_SCHEDULED: still costed (daily), and said so.
    expect(ci.item.assumption).toMatch(/Not on a schedule; assumed run daily/);
    const without = find(seedCandidates({ ...base(), insights: [], counts }), 'Calculated insight Avg_Spends__cio');
    expect(without.incomplete).toBe(true);
  });

  it('sizes segments from every object they read, not their members, and activations from members', () => {
    const c = seedCandidates({ ...base(), counts });
    const vip = find(c, 'Segment Lapsed_VIPs');
    expect(vip.item.kind).toBe('segmentation');
    // Built on UnifiedIndividual; criteria read Individual and EmailEngagement.
    expect(vip.item.perRun).toBe(1_600 + 2_500 + 5_000);
    expect(vip.incomplete).toBe(false);
    expect(vip.item.assumption).toMatch(/Publishes daily\./);
    expect(c.filter((x) => x.group === 'Segments').map((x) => x.item.label)).not.toContain('Draft Test');
    const act = c.find((x) => x.group === 'Activations' && x.item.source === 'Segment Lapsed_VIPs')!;
    expect(act.item).toMatchObject({ kind: 'activation_batch', perRun: 312 });
  });

  it('finds object names in SQL and criteria text', () => {
    expect(objectsMentioned('SELECT * FROM "ssot__Individual__dlm" JOIN Nope__dlm', objects)).toEqual(['ssot__Individual__dlm']);
  });
});

describe('stream settings from the API', () => {
  it('reads connector, refresh mode, frequency and last-run rows when present', () => {
    const { items } = normalizeStreams({
      dataStreams: [
        { name: 'a', connectorInfo: { connectorType: 'S3' }, refreshConfig: { refreshMode: 'FULL_REFRESH', frequency: { frequencyType: 'DAILY' } }, lastNumberOfRowsAddedCount: 42 },
        { name: 'b' },
      ],
    });
    expect(items[0]).toMatchObject({ connectorType: 'S3', refreshMode: 'FULL_REFRESH', refreshFrequency: 'DAILY', lastRunRecords: 42 });
    expect(Object.keys(items[1]!)).toEqual(['name', 'label']);
  });
});
