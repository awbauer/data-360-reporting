import { describe, expect, it } from 'vitest';
import { normalizeIdentityResolutions } from '../server/data360/normalize';
import { cookieJar, H, mockApp } from './helpers';

const json = (body: unknown) => ({ method: 'POST', headers: H, body: JSON.stringify(body) });

async function connected(email = 'alice@example.com') {
  const t = mockApp();
  const jar = cookieJar();
  await t.signIn(jar, email);
  await t.send(jar, '/auth/login');
  return { t, jar, req: (path: string, init: RequestInit = {}) => t.send(jar, path, init) };
}

describe('estimates are recorded with each run', () => {
  it('stores the estimate, and reports it in History and the audit CSV', async () => {
    const { t, req } = await connected();
    await req('/api/query', json({ sql: 'SELECT 1 AS a', estRows: 2_500_000, estComplete: true }));
    await req('/api/query', json({ sql: 'SELECT 2 AS b', estRows: 1000, estComplete: false }));
    await req('/api/query', json({ sql: 'SELECT 3 AS c' })); // nothing to estimate from
    const rows = (await t.db.prepare('select est_rows, est_complete from query_log order by started_at').all<Record<string, number | null>>()).results;
    expect(rows).toEqual([{ est_rows: 2_500_000, est_complete: 1 }, { est_rows: 1000, est_complete: 0 }, { est_rows: null, est_complete: null }]);
    const hist = await (await req('/api/history')).json();
    expect(hist.map((h: { estRows: number | null }) => h.estRows)).toEqual([null, 1000, 2_500_000]);
    expect(hist[2]).toMatchObject({ estRows: 2_500_000, estComplete: true });

    const admin = cookieJar();
    await t.signIn(admin, 'admin@example.org');
    const csv = await (await t.send(admin, '/api/audit?format=csv')).text();
    expect(csv.split('\n')[0]).toContain('est_rows_read,est_complete');
    expect(csv).toContain(',2500000,yes,');
  });

  it('refuses an estimate that is not a sane count', async () => {
    const { req } = await connected();
    for (const estRows of [-1, 1.5, 1e15, 'lots']) {
      expect((await req('/api/query', json({ sql: 'SELECT 1', estRows }))).status).toBe(400);
    }
  });
});

describe('usage summary for admins', () => {
  it('sums estimated rows by person and org, and says how much of the picture that is', async () => {
    const { t, req } = await connected('alice@example.com');
    await req('/api/query', json({ sql: 'SELECT 1', estRows: 4_000_000, estComplete: true }));
    await req('/api/query', json({ sql: 'SELECT 2', estRows: 1_000_000, estComplete: false }));
    await req('/api/query', json({ sql: 'SELECT 3' }));
    const bob = cookieJar();
    await t.signIn(bob, 'bob@example.com');
    await t.send(bob, '/auth/login');
    await t.send(bob, '/api/query', json({ sql: 'SELECT 4', estRows: 10, estComplete: true }));

    const admin = cookieJar();
    await t.signIn(admin, 'admin@example.org');
    const { days, rows } = await (await t.send(admin, '/api/admin/usage?days=7')).json();
    expect(days).toBe(7);
    expect(rows[0]).toMatchObject({ userEmail: 'alice@example.com', instanceHost: 'mock-org.my.salesforce.com', runs: 3, estimatedRuns: 2, partialRuns: 1, estRows: 5_000_000 });
    expect(rows[1]).toMatchObject({ userEmail: 'bob@example.com', runs: 1, estRows: 10 });
    expect((await t.send(bob, '/api/admin/usage')).status).toBe(403);
    expect((await t.send(admin, '/api/admin/usage?days=0')).status).toBe(400);
    await t.db.prepare('update query_log set started_at = 1 where user_email = ?').bind('bob@example.com').run();
    expect((await (await t.send(admin, '/api/admin/usage?days=7')).json()).rows.map((r: { userEmail: string }) => r.userEmail)).toEqual(['alice@example.com']);
  });
});

describe('identity resolution shapes (spec example)', () => {
  const SPEC = {
    identityResolutions: [
      {
        label: 'Individual Match', rulesetId: null, rulesetStatus: 'PUBLISHED', objectApiName: 'Individual', dataSpaceName: 'default',
        doesRunAutomatically: true, lastJobStatus: 'SUCCESS', lastJobCompleted: '2025-08-20T22:18:44.000Z', sourceProfiles: 4000,
        matchedSourceProfiles: 1500, totalUnifiedProfiles: 2500, knownUnifiedProfiles: 2400, anonymousUnifiedProfiles: 100, consolidationRate: 0.375,
        configurationType: 'individual',
        reconciliationRules: [{ entityName: 'ssot__Individual__dlm', linkDmoName: 'IndividualIdentityLink__dlm', unifiedDmoName: 'UnifiedIndividual__dlm', ruleType: 'lastupdated', fields: [] }],
      },
    ],
  };

  it('reads rulesets with their counts and the objects they write to', () => {
    expect(normalizeIdentityResolutions(SPEC)).toEqual([
      {
        label: 'Individual Match', status: 'PUBLISHED', objectApiName: 'Individual', dataSpace: 'default', runsAutomatically: true,
        lastJobStatus: 'SUCCESS', lastJobCompleted: '2025-08-20T22:18:44.000Z', sourceProfiles: 4000, matchedSourceProfiles: 1500,
        totalUnifiedProfiles: 2500, knownUnifiedProfiles: 2400, anonymousUnifiedProfiles: 100, consolidationRate: 0.375,
        outputs: [{ entity: 'ssot__Individual__dlm', linkDmo: 'IndividualIdentityLink__dlm', unifiedDmo: 'UnifiedIndividual__dlm' }],
      },
    ]);
    expect(normalizeIdentityResolutions({})).toEqual([]);
    expect(normalizeIdentityResolutions({ identityResolutions: [{}] })[0]).toMatchObject({ label: 'Ruleset', outputs: [] });
  });

  it('serves them for the current data space, from the mock, consistent with the identity queries', async () => {
    const { req } = await connected();
    const sets = await (await req('/api/identity?dataspace=default')).json();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ label: 'Individual Match', sourceProfiles: 2500, runsAutomatically: true });
    expect(sets[0].totalUnifiedProfiles).toBeLessThan(2500);
    expect(sets[0].consolidationRate).toBeCloseTo(1 - sets[0].totalUnifiedProfiles / 2500, 6);
    const q = await (await req('/api/query', json({ sql: 'SELECT COUNT(DISTINCT "UnifiedRecordId__c") FROM "IndividualIdentityLink__dlm"' }))).json();
    expect(q.rows[0][0]).toBe(sets[0].totalUnifiedProfiles);
    expect(await (await req('/api/identity?dataspace=marketing')).json()).toEqual([]);
  });
});
