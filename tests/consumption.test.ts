import { beforeAll, describe, expect, it } from 'vitest';
import {
  attributedCredits,
  dailySql,
  entitlementSql,
  findSources,
  isoDay,
  monthlySql,
  normalizeField,
  normalizeObject,
  parseDaily,
  parseEntitlement,
  parseMonthly,
  parseResources,
  pickSources,
  planActuals,
  resourcesSql,
  summarize,
  type BuiltQuery,
  type Consumption,
  type Source,
} from '../shared/consumption';
import { createMockClient } from '../server/data360/mock/client';
import type { ObjectMeta } from '../shared/types';

const NOW = Date.parse('2026-10-07T13:30:00Z');
const DAY = 86_400_000;
const client = createMockClient({ now: NOW });
let objects: ObjectMeta[];

const run = async (b: { sql: string; since?: string }) => {
  const params = b.since ? [{ name: 'since', type: 'Date' as const, value: b.since }] : [];
  return client.submitQuery({ sql: b.sql, dataspace: 'default', params, rowLimit: 50_000 });
};

beforeAll(async () => {
  objects = (await client.getMetadata('default')).objects;
});

describe('finding consumption data', () => {
  it('normalizes the DLO, DMO and standard spellings of the same object and field', () => {
    expect(normalizeObject('TenantDailyEntitlementConsumption__dll')).toBe('tenantdailyentitlementconsumption');
    expect(normalizeObject('std__TenantConsumptionInsightsDmo__dlm')).toBe('tenantconsumptioninsights');
    expect(normalizeObject('TenantConsumptionInsights_std__dlm')).toBe('tenantconsumptioninsights');
    expect(normalizeField('unitsconsumed__c')).toBe('unitsconsumed');
    expect(normalizeField('std__UnitsConsumed__c')).toBe('unitsconsumed');
    expect(normalizeField('ssot__Usage_Business_Env_Type__c')).toBe('usagebusinessenvtype');
  });

  it('finds the mock org’s feeds and the fields Salesforce documents', () => {
    const sources = findSources(objects);
    expect(sources.map((s) => s.kind)).toEqual(['daily', 'hourly', 'entitlement']);
    const [daily, hourly, ent] = sources as [Source, Source, Source];
    expect(Object.fromEntries(Object.entries(daily.fields).map(([r, f]) => [r, f!.name]))).toMatchObject({
      date: 'utilizationdate__c', credits: 'unitsconsumed__c', usage: 'usageconsumed__c', card: 'carddefinitiondevelopername__c', env: 'usagebusinessenvtype__c',
    });
    expect(hourly.fields.resource?.name).toBe('resourceidorapiname__c');
    expect(hourly.fields.rowDetail?.name).toBe('rowdetail__c');
    expect(ent.fields.quantity?.name).toBe('quantity__c');
    expect(sources.every((s) => s.missing.length === 0)).toBe(true);
    const pick = pickSources(sources);
    expect([pick.totals?.kind, pick.resources?.kind, pick.entitlement?.kind]).toEqual(['daily', 'hourly', 'entitlement']);
  });

  it('reads the standard DMO too, by its std__ field names, and says what it lacks', () => {
    const dmo: ObjectMeta = {
      name: 'std__TenantConsumptionInsightsDmo__dlm', label: 'Tenant Consumption Insights', kind: 'dmo', category: 'Other', primaryKeys: [], relationships: [],
      fields: [
        { name: 'std__UsageTypeDeveloperName__c', label: 'Usage Type', type: 'STRING', isPk: false },
        { name: 'std__UnitsConsumed__c', label: 'Units Consumed', type: 'NUMBER', isPk: false },
        { name: 'std__UsageDate__c', label: 'Usage Date', type: 'DATE', isPk: false },
      ],
    };
    const [s] = findSources([dmo]);
    expect(s).toMatchObject({ kind: 'events' });
    expect(s!.fields.usageType?.name).toBe('std__UsageTypeDeveloperName__c');
    expect(s!.missing).toEqual(['card', 'env']);
    expect(pickSources([s!]).totals).toBe(s);
    // A DATE column needs no cast; a text one (as in Salesforce's DLO examples) does.
    expect(dailySql(s!, '2026-09-01').sql).toContain('DATE_TRUNC(\'day\', "std__UsageDate__c")');
  });

  it('ignores objects that only look similar, and sources without the fields it needs', () => {
    const lookalike: ObjectMeta = { name: 'TenantDailyNotes__dll', label: 'x', kind: 'dlo', category: 'Other', fields: [], primaryKeys: [], relationships: [] };
    const empty: ObjectMeta = { ...lookalike, name: 'TenantDailyEntitlementConsumption__dll' };
    expect(findSources([lookalike])).toEqual([]);
    const [s] = findSources([empty]);
    expect(s!.missing).toContain('credits');
    expect(pickSources([s!]).totals).toBeUndefined();
  });
});

describe('the SQL', () => {
  it('casts text dates, filters unprocessed hours, and quotes every name', () => {
    const { totals, resources, entitlement } = pickSources(findSources(objects));
    const m = monthlySql(totals!, '2025-10-01');
    expect(m.sql).toContain('DATE_TRUNC(\'month\', CAST("utilizationdate__c" AS DATE)) AS "month"');
    expect(m.sql).toContain('GROUP BY 1, 2, 3');
    const r = resourcesSql(resources!, '2026-09-07');
    expect(r.sql).toContain('CAST("usagehourbucket__c" AS TIMESTAMP) >= :since AND "rowdetail__c" = \'PROCESSED\'');
    expect(entitlementSql(entitlement!).sql).toBe('SELECT "carddefinitiondevelopername__c" AS "card", SUM("quantity__c") AS "credits"\nFROM "TenantEntitlementTransaction__dll"\nGROUP BY 1');
  });
});

describe('reading the mock org’s consumption', () => {
  let c: Consumption;
  beforeAll(async () => {
    const { totals, resources, entitlement } = pickSources(findSources(objects));
    const monthlySince = '2025-10-01';
    const dailySince = isoDay(NOW - 90 * DAY);
    const resourcesSince = isoDay(NOW - 30 * DAY);
    const exec = async (b: BuiltQuery | { sql: string }) => {
      const r = await run(b);
      return [r.columns!, r.rows] as const;
    };
    c = {
      at: new Date(NOW).toISOString(),
      sources: { totals: totals!.object.name, resources: resources!.object.name, entitlement: entitlement!.object.name },
      monthlySince,
      dailySince,
      resourcesSince,
      monthly: parseMonthly(...(await exec(monthlySql(totals!, monthlySince)))),
      daily: parseDaily(...(await exec(dailySql(totals!, dailySince)))),
      resources: parseResources(...(await exec(resourcesSql(resources!, resourcesSince)))),
      entitlement: parseEntitlement(...(await exec(entitlementSql(entitlement!)))),
    };
  });

  it('gives months by card and environment, and days in order', () => {
    expect(c.monthly[0]!.month).toBe('2025-10');
    expect(new Set(c.monthly.map((m) => m.card))).toEqual(new Set(['Data360Credits', 'AgentforceCredits']));
    expect(new Set(c.monthly.map((m) => m.env))).toEqual(new Set(['PRODUCTION', 'SANDBOX']));
    expect(c.daily.length).toBeGreaterThanOrEqual(90);
    expect(c.daily.map((d) => d.day)).toEqual([...c.daily.map((d) => d.day)].sort());
  });

  it('attributes credits to resources, identity resolution first', () => {
    expect(c.resources[0]).toMatchObject({ resourceType: 'IdentityResolution', resource: 'Individual_Default_Ruleset' });
    // A segment's production and sandbox runs, found by its API name or its label.
    const vip = attributedCredits(c.resources, ['Lapsed_VIPs']);
    expect(vip.matched.length).toBe(1);
    expect(attributedCredits(c.resources, ['Lapsed VIPs']).credits).toBe(vip.credits);
    expect(vip.credits).toBeGreaterThan(30 * 140 * 0.85);
    expect(attributedCredits(c.resources, ['Avg Spends', 'Avg_Spends__cio']).matched).toHaveLength(1);
  });

  it('summarizes: the last 30 days agree with what the resources consumed', () => {
    const s = summarize(c, NOW);
    // ~2,673 a day of Data 360 (production + sandbox) plus ~200 of Agentforce, give or take noise.
    expect(s.last30).toBeGreaterThan(30 * 2_873 * 0.85);
    expect(s.last30).toBeLessThan(30 * 2_873 * 1.15);
    expect(s.dailyAverage).toBeCloseTo(s.last30 / 30, 9);
    const resourceTotal = c.resources.reduce((t, r) => t + r.credits, 0);
    expect(resourceTotal / (s.last30 - 30 * 200)).toBeGreaterThan(0.9);
    expect(s.purchased).toBe(1_600_000);
    expect(s.remaining).toBeCloseTo(1_600_000 - s.consumed, 6);
    expect(s.runwayDays).toBeCloseTo(s.remaining! / s.dailyAverage, 6);
    expect(s.byMonth.every((m) => m.sandbox < m.production)).toBe(true);
    expect(s.byCard[0]!.card).toBe('Data360Credits');
  });

  it('filters to chosen cards', () => {
    const only = summarize(c, NOW, { cards: new Set(['Data360Credits']) });
    const all = summarize(c, NOW);
    expect(only.purchased).toBe(1_500_000);
    expect(only.thisMonth).toBeLessThan(all.thisMonth);
    expect(only.byCard.map((x) => x.card)).toEqual(['Data360Credits']);
  });

  it('counts consumed and remaining from the contract start', () => {
    const all = summarize(c, NOW);
    const fromAug = summarize(c, NOW, { from: '2026-08' });
    const months = c.monthly.filter((m) => m.month >= '2026-08').reduce((t, m) => t + m.credits, 0);
    expect(fromAug.consumed).toBeCloseTo(months, 6);
    expect(fromAug.remaining).toBeGreaterThan(all.remaining!);
    expect(fromAug.last30).toBe(all.last30);
  });

  it('turns months into plan actuals, production only unless asked', () => {
    const a = planActuals(c, '2026-08', 12, { includeSandbox: false });
    expect(a.map((x) => x.month)).toEqual([1, 2, 3]); // Aug, Sep, Oct 2026 so far
    const withSandbox = planActuals(c, '2026-08', 12, { includeSandbox: true });
    expect(withSandbox[0]!.credits).toBeGreaterThan(a[0]!.credits);
    const through = planActuals(c, '2026-08', 12, { includeSandbox: false, through: '2026-09' });
    expect(through.map((x) => x.month)).toEqual([1, 2]);
  });
});
