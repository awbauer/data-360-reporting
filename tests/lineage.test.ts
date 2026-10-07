import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeInsight, normalizeMappings, normalizeSegments, normalizeStreams } from '../server/data360/normalize';
import type { FetchLike } from '../server/oauth';
import { cookieJar, H, mockApp, realApp } from './helpers';

describe('mapping and definition normalizers (shapes from the spec, not yet a real org)', () => {
  it('reads objectSourceTargetMaps with field pairs, and tolerates other spellings', () => {
    const spec = normalizeMappings({
      objectSourceTargetMaps: [{
        developerName: 'Map1', sourceEntityDeveloperName: 'Web__dll', targetEntityDeveloperName: 'ssot__Individual__dlm',
        fieldMappings: [{ sourceFieldDeveloperName: 'id__c', targetFieldDeveloperName: 'ssot__Id__c' }],
      }],
    });
    expect(spec.mappings).toEqual([{ name: 'Map1', source: 'Web__dll', target: 'ssot__Individual__dlm', fields: [{ source: 'id__c', target: 'ssot__Id__c' }] }]);
    const other = normalizeMappings([{ source: { name: 'A__dll' }, target: { developerName: 'B__dlm' }, fields: [{ sourceField: 'x', targetField: 'y' }] }]);
    expect(other.mappings[0]).toMatchObject({ source: 'A__dll', target: 'B__dlm', fields: [{ source: 'x', target: 'y' }] });
    expect(normalizeMappings({}).mappings).toEqual([]);
    expect(normalizeMappings({ unexpected: true }).raw).toEqual({ unexpected: true });
  });

  it('reads an insight definition from an object or a one-item list', () => {
    const body = {
      apiName: 'LTV__cio', displayName: 'LTV', expression: 'SELECT 1', calculatedInsightStatus: 'ACTIVE',
      dimensions: [{ apiName: 'Id__c', displayName: 'Id' }], measures: [{ apiName: 'V__c', fieldAggregationType: 'SUM' }],
    };
    const d = normalizeInsight(body, 'LTV__cio');
    expect(d).toMatchObject({ name: 'LTV__cio', label: 'LTV', expression: 'SELECT 1', status: 'ACTIVE' });
    expect(d.measures).toEqual([{ name: 'V__c', label: 'V__c', formula: 'SUM' }]);
    expect(normalizeInsight({ calculatedInsights: [body] }, 'x').expression).toBe('SELECT 1');
    expect(normalizeInsight({}, 'Fallback__cio')).toMatchObject({ name: 'Fallback__cio', dimensions: [], measures: [] });
  });

  it('keeps segment criteria as text, whether the API sends a string or an object', () => {
    const [a, b] = normalizeSegments({
      segments: [
        { apiName: 'A', includeCriteria: '{"x":1}', segmentOnApiName: 'UnifiedIndividual__dlm', description: 'd' },
        { apiName: 'B', includeCriteria: { y: 2 }, excludeCriteria: '' },
      ],
    });
    expect(a).toMatchObject({ includeCriteria: '{"x":1}', segmentOn: 'UnifiedIndividual__dlm', description: 'd' });
    expect(b!.includeCriteria).toBe('{"y":2}');
    expect(b!.excludeCriteria).toBeUndefined();
  });

  it("reads a stream's data lake object", () => {
    const { items } = normalizeStreams({ dataStreams: [{ name: 'S', dataLakeObjectInfo: { name: 'Web__dll' } }, { name: 'T' }] });
    expect(items[0]!.dataLakeObject).toBe('Web__dll');
    expect(items[1]!.dataLakeObject).toBeUndefined();
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

  it("returns a DMO's sources and a DLO's targets", async () => {
    const dmo = await (await req('/api/mappings?dataspace=default&kind=dmo&object=ssot__ContactPointEmail__dlm')).json();
    expect(dmo.mappings).toHaveLength(1);
    expect(dmo.mappings[0]).toMatchObject({ source: 'Contact_Home__dll', target: 'ssot__ContactPointEmail__dlm' });
    expect(dmo.mappings[0].fields).toContainEqual({ source: 'Email__c', target: 'ssot__EmailAddress__c' });
    const dlo = await (await req('/api/mappings?dataspace=default&kind=dlo&object=Contact_Home__dll')).json();
    expect(dlo.mappings.map((m: { target: string }) => m.target).sort()).toEqual(['ssot__ContactPointEmail__dlm', 'ssot__Individual__dlm']);
  });

  it('returns an insight definition, 404s an unknown one, and validates names', async () => {
    const d = await (await req('/api/insights/Avg_Spends__cio?dataspace=default')).json();
    expect(d).toMatchObject({ name: 'Avg_Spends__cio', status: 'ACTIVE', definitionType: 'CALCULATED_METRIC' });
    expect(d.expression).toMatch(/^SELECT AVG/);
    expect((await req('/api/insights/Nope__cio?dataspace=default')).status).toBe(404);
    expect((await req('/api/insights/a.b?dataspace=default')).status).toBe(400);
    expect((await req('/api/mappings?dataspace=default&kind=ci&object=X')).status).toBe(400);
    expect((await req('/api/mappings?dataspace=default&kind=dmo&object=a%27b')).status).toBe(400);
  });

  it('requires a Salesforce connection like every other data call', async () => {
    const other = cookieJar();
    await t.signIn(other, 'other@example.com', false);
    expect((await t.send(other, '/api/mappings?kind=dmo&object=X')).status).toBe(401);
  });
});

describe('Connect API requests', () => {
  it('asks for mappings by the right developer-name parameter and encodes insight names', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      if (url.endsWith('/services/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'AT', instance_url: 'https://acme.my.salesforce.com' }));
      }
      return new Response(JSON.stringify(url.includes('/calculated-insights/') ? { apiName: 'X__cio' } : { objectSourceTargetMaps: [] }));
    };
    const app = realApp(fetchFn);
    const jar = cookieJar();
    const login = await app.request('/auth/login');
    jar.absorb(login);
    const state = new URL(login.headers.get('location')!).searchParams.get('state');
    jar.absorb(await app.request(`/auth/callback?code=C&state=${state}`, { headers: { cookie: jar.header() } }));
    const get = (p: string) => app.request(p, { headers: { ...H, cookie: jar.header() } });
    await get('/api/mappings?dataspace=default&kind=dmo&object=ssot__Individual__dlm');
    await get('/api/mappings?dataspace=default&kind=dlo&object=Web__dll');
    await get('/api/insights/X__cio?dataspace=default');
    const api = urls.filter((u) => u.includes('/ssot/')).map((u) => u.replace(/^.*\/ssot/, ''));
    expect(api).toEqual([
      '/data-model-object-mappings?dataspace=default&dmoDeveloperName=ssot__Individual__dlm',
      '/data-model-object-mappings?dataspace=default&dloDeveloperName=Web__dll',
      '/calculated-insights/X__cio?dataspace=default',
    ]);
  });
});
