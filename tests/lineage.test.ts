import { beforeAll, describe, expect, it } from 'vitest';
import { createMockClient } from '../server/data360/mock/client';
import { normalizeInsight, normalizeMappings, normalizeSegments, normalizeStreams } from '../server/data360/normalize';
import type { FetchLike } from '../server/oauth';
import { cookieJar, H, mockApp, realApp } from './helpers';

// Payloads below are copied (shortened) from the examples in Salesforce's Connect API spec (v68.0).

const SPEC_MAPPINGS = {
  objectSourceTargetMaps: [
    {
      developerName: 'exercise_map_Account_1755672548340',
      fieldMappings: [
        { developerName: 'DataSource__c_fieldmap_ssot__DataSourceId__c', sourceFieldDeveloperName: 'DataSource__c', targetFieldDeveloperName: 'ssot__DataSourceId__c' },
        { developerName: 'runid__c_fieldmap_ssot__Id__c', sourceFieldDeveloperName: 'runid__c', targetFieldDeveloperName: 'ssot__Id__c' },
      ],
      sourceEntityDeveloperName: 'exercise__dll',
      status: 'ACTIVE',
      targetEntityDeveloperName: 'ssot__Account__dlm',
    },
  ],
};

const SPEC_INSIGHT = {
  apiName: 'Unified_Individual_Case_Counts__cio',
  calculatedInsightStatus: 'ACTIVE',
  creationType: 'Custom',
  dataSpace: 'default',
  definitionStatus: 'IN_USE',
  definitionType: 'CALCULATED_METRIC',
  description: 'This is an updated description for the calculated insight.',
  dimensions: [
    {
      apiName: 'unified_individual__c', creationType: 'Custom', dataSource: { sourceApiName: 'ssot__IndividualId__c', type: 'DATA_MODEL' },
      dataType: 'Text', dateGranularity: null, displayName: 'Unified Individual', fieldRole: 'DIMENSION', formula: 'UnifiedIndividual__dlm.ssot__Id__c',
    },
  ],
  displayName: 'Unified Individual Case Counts 2025',
  expression: 'SELECT COUNT(ssot__Case__dlm.ssot__Id__c) AS count_case_id__c FROM UnifiedIndividual__dlm GROUP BY unified_individual__c',
  isEnabled: true,
  lastCalcInsightStatusDateTime: '2025-08-21T22:55:00.000Z',
  lastCalcInsightStatusErrorCode: null,
  lastRunDateTime: '2025-08-21T22:49:08.000Z',
  lastRunStatus: 'SUCCESS',
  lastRunStatusDateTime: '2025-08-21T22:51:32.000Z',
  lastRunStatusErrorCode: null,
  measures: [
    {
      apiName: 'count_case_id__c', creationType: 'Custom', dataSource: { sourceApiName: 'ssot__IndividualId__c', type: 'DATA_MODEL' },
      dataType: 'Number', displayName: 'Count Case ID', fieldAggregationType: 'AGGREGATABLE', fieldRole: 'MEASURE', formula: 'COUNT(ssot__Case__dlm.ssot__Id__c)',
    },
  ],
  publishScheduleEndDate: null,
  publishScheduleInterval: 'NOT_SCHEDULED',
  publishScheduleStartDateTime: null,
};

describe('normalizers against the spec examples', () => {
  it('reads objectSourceTargetMaps with their field pairs and status', () => {
    const { mappings } = normalizeMappings(SPEC_MAPPINGS);
    expect(mappings).toEqual([
      {
        name: 'exercise_map_Account_1755672548340',
        status: 'ACTIVE',
        source: 'exercise__dll',
        target: 'ssot__Account__dlm',
        fields: [
          { source: 'DataSource__c', target: 'ssot__DataSourceId__c' },
          { source: 'runid__c', target: 'ssot__Id__c' },
        ],
      },
    ]);
    expect(normalizeMappings({ objectSourceTargetMaps: [] }).mappings).toEqual([]);
    expect(normalizeMappings({ unexpected: true }).raw).toEqual({ unexpected: true });
  });

  it('reads an insight definition: formulas, run time, errors, schedule', () => {
    const d = normalizeInsight(SPEC_INSIGHT, 'Unified_Individual_Case_Counts__cio');
    expect(d).toMatchObject({
      name: 'Unified_Individual_Case_Counts__cio',
      label: 'Unified Individual Case Counts 2025',
      status: 'ACTIVE',
      definitionStatus: 'IN_USE',
      definitionType: 'CALCULATED_METRIC',
      enabled: true,
      lastRunStatus: 'SUCCESS',
      schedule: 'NOT_SCHEDULED',
    });
    // The run time, not the later status-update times.
    expect(d.lastRunAt).toBe('2025-08-21T22:49:08.000Z');
    expect(d.lastRunError).toBeUndefined(); // null error codes mean no error
    expect(d.dimensions).toEqual([{ name: 'unified_individual__c', label: 'Unified Individual', formula: 'UnifiedIndividual__dlm.ssot__Id__c', dataType: 'Text' }]);
    // fieldAggregationType is an enum (AGGREGATABLE), never a formula.
    expect(d.measures).toEqual([{ name: 'count_case_id__c', label: 'Count Case ID', formula: 'COUNT(ssot__Case__dlm.ssot__Id__c)', dataType: 'Number' }]);
    expect(JSON.stringify([d.dimensions, d.measures])).not.toContain('AGGREGATABLE');
  });

  it('reports a failed run, and accepts the list endpoint wrapper', () => {
    const failed = { ...SPEC_INSIGHT, lastRunStatus: 'FAILURE', lastRunStatusErrorCode: 'QUERY_TIMEOUT', isEnabled: false };
    const d = normalizeInsight({ count: 1, items: [failed] }, 'x');
    expect(d).toMatchObject({ lastRunStatus: 'FAILURE', lastRunError: 'QUERY_TIMEOUT', enabled: false });
    expect(normalizeInsight({}, 'Fallback__cio')).toMatchObject({ name: 'Fallback__cio', dimensions: [], measures: [] });
  });

  it('reads segment rules (strings), schedule and the segment-on object', () => {
    const [a, b] = normalizeSegments({
      segments: [
        {
          apiName: 'VIP', displayName: 'VIP', segmentStatus: 'ACTIVE', publishStatus: 'PUBLISH_SUCCESS', lastSegmentMemberCount: 312,
          lastPublishedEndDateTime: '2026-10-05T12:00:00Z', nextPublishDateTime: '2026-10-08T06:00:00Z', publishInterval: 'DAILY',
          segmentOnApiName: 'UnifiedIndividual__dlm', segmentType: 'UI', description: 'd', includeCriteria: '{"filter":{"x":1}}', excludeCriteria: null,
        },
        { apiName: 'B', includeCriteria: { y: 2 }, excludeCriteria: '' },
      ],
    });
    expect(a).toMatchObject({
      label: 'VIP', status: 'ACTIVE', lastMemberCount: 312, nextPublish: '2026-10-08T06:00:00Z', publishInterval: 'DAILY',
      segmentOn: 'UnifiedIndividual__dlm', includeCriteria: '{"filter":{"x":1}}',
    });
    expect(a!.excludeCriteria).toBeUndefined();
    expect(b!.includeCriteria).toBe('{"y":2}');
    expect(b!.excludeCriteria).toBeUndefined();
  });

  it("reads a stream's data lake object from dataLakeObjectInfo.name", () => {
    const { items } = normalizeStreams({ dataStreams: [{ name: 'S', dataLakeObjectInfo: { name: 'Web__dll', label: 'Web', category: 'Profile' } }, { name: 'T' }] });
    expect(items[0]!.dataLakeObject).toBe('Web__dll');
    expect(items[1]!.dataLakeObject).toBeUndefined();
  });
});

describe('mock mirrors the API contract', () => {
  it('requires the DMO for mappings, and narrows by DLO only on request', async () => {
    const mock = createMockClient();
    await expect(mock.getMappings('default', '')).rejects.toMatchObject({ status: 400, code: 'REQUIRED_QUERY_PARAMETER_MISSING' });
    const all = await mock.getMappings('default', 'ssot__ContactPointEmail__dlm');
    expect(all.mappings.map((m) => m.source)).toEqual(['Contact_Home__dll']);
    expect((await mock.getMappings('default', 'ssot__ContactPointEmail__dlm', 'Other__dll')).mappings).toEqual([]);
    expect((await mock.getMappings('default', 'ssot__Account__dlm')).mappings).toEqual([]); // a DMO nothing maps into
  });
});

describe('mapping and definition routes', () => {
  const t = mockApp();
  const jar = cookieJar();
  const req = (path: string) => t.send(jar, path);
  beforeAll(async () => {
    await t.signIn(jar, 'demo@example.com', false);
    await req('/auth/login');
  });

  it("returns the mappings into a DMO, optionally narrowed to one DLO", async () => {
    const all = await (await req('/api/mappings?dataspace=default&dmo=ssot__ContactPointEmail__dlm')).json();
    expect(all.mappings).toHaveLength(1);
    expect(all.mappings[0]).toMatchObject({ status: 'ACTIVE', source: 'Contact_Home__dll', target: 'ssot__ContactPointEmail__dlm' });
    expect(all.mappings[0].fields).toContainEqual({ source: 'Email__c', target: 'ssot__EmailAddress__c' });
    expect(all.raw.objectSourceTargetMaps).toHaveLength(1);
    const narrowed = await (await req('/api/mappings?dataspace=default&dmo=ssot__ContactPointEmail__dlm&dlo=Contact_Home__dll')).json();
    expect(narrowed.mappings).toHaveLength(1);
    expect((await (await req('/api/mappings?dmo=ssot__ContactPointEmail__dlm&dlo=Nope__dll')).json()).mappings).toEqual([]);
  });

  it('insists on a DMO, like Salesforce does, and validates names', async () => {
    expect((await req('/api/mappings?dataspace=default')).status).toBe(400);
    expect((await req('/api/mappings?dataspace=default&dlo=Contact_Home__dll')).status).toBe(400);
    expect((await req('/api/mappings?dmo=a%27b')).status).toBe(400);
    expect((await req('/api/mappings?dmo=ssot__Individual__dlm&dlo=a%20b')).status).toBe(400);
  });

  it('returns an insight definition, 404s an unknown one, and validates names', async () => {
    const d = await (await req('/api/insights/Avg_Spends__cio')).json();
    expect(d).toMatchObject({ name: 'Avg_Spends__cio', status: 'ACTIVE', definitionStatus: 'IN_USE', definitionType: 'CALCULATED_METRIC', lastRunStatus: 'SUCCESS', schedule: 'NOT_SCHEDULED' });
    expect(d.expression).toMatch(/^SELECT AVG/);
    expect(d.measures[0]).toMatchObject({ formula: 'AVG(SalesOrder__dlm.grand_total_amount__c)', dataType: 'Number' });
    expect((await req('/api/insights/Nope__cio')).status).toBe(404);
    expect((await req('/api/insights/a.b')).status).toBe(400);
  });

  it('requires a Salesforce connection like every other data call', async () => {
    const other = cookieJar();
    await t.signIn(other, 'other@example.com', false);
    expect((await t.send(other, '/api/mappings?dmo=X')).status).toBe(401);
  });
});

describe('Connect API requests', () => {
  it('sends exactly the parameters the spec defines', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      if (url.endsWith('/services/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'AT', instance_url: 'https://acme.my.salesforce.com' }));
      }
      return new Response(JSON.stringify(url.includes('/calculated-insights/') ? { apiName: 'X__cio' } : { objectSourceTargetMaps: [] }));
    };
    const app = realApp(fetchFn, { SF_AUTHORIZE_PREFLIGHT: '0' });
    const jar = cookieJar();
    const login = await app.request('/auth/login');
    jar.absorb(login);
    const state = new URL(login.headers.get('location')!).searchParams.get('state');
    jar.absorb(await app.request(`/auth/callback?code=C&state=${state}`, { headers: { cookie: jar.header() } }));
    const get = (p: string) => app.request(p, { headers: { ...H, cookie: jar.header() } });
    await get('/api/mappings?dataspace=default&dmo=ssot__Individual__dlm');
    await get('/api/mappings?dataspace=default&dmo=ssot__Individual__dlm&dlo=Web__dll');
    await get('/api/insights/X__cio');
    const api = urls.filter((u) => u.includes('/ssot/')).map((u) => u.replace(/^.*\/ssot/, ''));
    expect(api).toEqual([
      '/data-model-object-mappings?dataspace=default&dmoDeveloperName=ssot__Individual__dlm',
      '/data-model-object-mappings?dataspace=default&dmoDeveloperName=ssot__Individual__dlm&dloDeveloperName=Web__dll',
      '/calculated-insights/X__cio', // the spec defines no query parameters for this call
    ]);
  });
});
