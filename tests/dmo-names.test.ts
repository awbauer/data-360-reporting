import { describe, expect, it } from 'vitest';
import { dmoOrigin, fieldKey, findField, findObject, objectKey } from '../shared/dmo-names';
import { STANDARD_DMOS } from '../shared/standard-dmos';
import { seedCandidates } from '../shared/credits-seed';
import { isSourceProfile } from '../shared/credit-forecast';
import type { ObjectMeta } from '../shared/types';

const obj = (name: string, kind: ObjectMeta['kind'] = 'dmo', fields: string[] = []): ObjectMeta => ({
  name, label: name, kind, category: 'Profile', primaryKeys: [], relationships: [],
  fields: fields.map((f) => ({ name: f, label: f, type: 'STRING', isPk: false })),
});
const keys = new Set(STANDARD_DMOS.map((d) => d.key));

describe('object and field keys', () => {
  it('give every generation of a name the same key', () => {
    for (const n of ['ssot__Individual__dlm', 'Individual_std__dlm', 'std__IndividualDmo__dlm', 'Individual__dlm']) expect(objectKey(n)).toBe('individual');
    expect(objectKey('TenantDailyEntitlementConsumption__dll')).toBe('tenantdailyentitlementconsumption');
    expect(fieldKey('ssot__FirstName__c')).toBe(fieldKey('std__firstname__c'));
  });

  it('find objects and fields in the order asked, whatever their spelling', () => {
    const objects = [obj('Individual_std__dlm', 'dmo', ['std__FirstName__c']), obj('IndividualIdentityLink__dlm')];
    expect(findObject(objects, 'individualidentitylink', 'individual')?.name).toBe('IndividualIdentityLink__dlm');
    expect(findObject(objects, 'account', 'individual')?.name).toBe('Individual_std__dlm');
    expect(findField(objects[0]!, 'firstname')?.name).toBe('std__FirstName__c');
  });
});

describe('the standard DMO index', () => {
  it('has all 1,554 objects with unique keys and reference links', () => {
    expect(STANDARD_DMOS).toHaveLength(1554);
    expect(keys.size).toBe(1554);
    const ind = STANDARD_DMOS.find((d) => d.label === 'Individual')!;
    expect(ind).toEqual({ label: 'Individual', key: 'individual', url: 'https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360dm-si-individualdmo-dmo.html' });
    // Where the reference page uses an abbreviated name, that name is the key.
    expect(STANDARD_DMOS.find((d) => d.label === 'Legal Entity')?.key).toBe('legalenty');
    expect(keys.has('tenantconsumptioninsights')).toBe(true);
    expect(keys.has('glbtenantentitlementtransaction')).toBe(true);
  });

  it('tells standard, identity-resolution and custom objects apart', () => {
    expect(dmoOrigin('ssot__Individual__dlm', keys)).toBe('standard');
    expect(dmoOrigin('Individual_std__dlm', keys)).toBe('standard');
    expect(dmoOrigin('LegalEnty_std__dlm', keys)).toBe('standard');
    expect(dmoOrigin('UnifiedIndividual__dlm', keys)).toBe('identity');
    expect(dmoOrigin('IndividualIdentityLink__dlm', keys)).toBe('identity');
    expect(dmoOrigin('Loyalty_Tier_Snapshot__dlm', keys)).toBe('custom');
  });
});

describe('an org on the new names', () => {
  it('still gets identity resolution seeded and priced', () => {
    const objects = [obj('Individual_std__dlm'), obj('UnifiedIndividual_std__dlm'), obj('IndividualIdentityLink_std__dlm')];
    const at = '2026-10-06T00:00:00Z';
    let n = 0;
    const c = seedCandidates({
      objects, extras: null, insights: [], changeRate: 0.05, newId: () => `s${++n}`,
      counts: { IndividualIdentityLink_std__dlm: { rows: 1_000_000, at } },
    });
    const ir = c.find((x) => x.group === 'Identity resolution')!;
    expect(ir.item.perRun).toBe(50_000);
    expect(ir.item.assumption).toMatch(/IndividualIdentityLink_std__dlm/);
    expect(isSourceProfile(objects[0]!)).toBe(true);
    expect(isSourceProfile(objects[1]!)).toBe(false);
  });
});

