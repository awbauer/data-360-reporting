// Recognizing a data model object whatever generation its API name is from. Salesforce's standard
// DMOs added after January 2026 use a `_std__dlm` suffix (some pages show `std__…Dmo__dlm`)
// instead of the `ssot__` prefix; an org can have either, never both, and their field names can
// differ in case. Code that looks for "the Individual object" should match on this key, not on
// one spelling. (The full list of standard DMOs is in standard-dmos.ts, loaded on demand.)
import type { FieldMeta, ObjectMeta } from './types';

/** `ssot__Individual__dlm`, `Individual_std__dlm`, `std__IndividualDmo__dlm` → `individual`. */
export function objectKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(std|ssot)__/, '')
    .replace(/(_std)?__(dlm|dll|cio)$/, '')
    .replace(/_/g, '')
    .replace(/dmo$/, '');
}

/** `std__UnitsConsumed__c`, `unitsconsumed__c`, `ssot__Units_Consumed__c` → `unitsconsumed`. */
export function fieldKey(name: string): string {
  return name.toLowerCase().replace(/^(std|ssot)__/, '').replace(/__c$/, '').replace(/_/g, '');
}

/** The first object matching any of `keys` (objectKey form), in the order given. */
export function findObject(objects: ObjectMeta[], ...keys: string[]): ObjectMeta | undefined {
  for (const k of keys) {
    const hit = objects.find((o) => objectKey(o.name) === k);
    if (hit) return hit;
  }
  return undefined;
}

/** The first field of `obj` matching any of `keys` (fieldKey form). */
export function findField(obj: ObjectMeta, ...keys: string[]): FieldMeta | undefined {
  for (const k of keys) {
    const hit = obj.fields.find((f) => fieldKey(f.name) === k);
    if (hit) return hit;
  }
  return undefined;
}

export type DmoOrigin = 'standard' | 'identity' | 'custom';

/**
 * Where a DMO comes from: Salesforce's standard set, identity resolution (unified profiles and
 * their link objects, generated per ruleset), or the org itself. `standardKeys` are the keys of
 * the standard DMO index.
 */
export function dmoOrigin(name: string, standardKeys: Set<string>): DmoOrigin {
  const k = objectKey(name);
  if (/^unified|identitylink$|^unifiedlink/.test(k)) return 'identity';
  return standardKeys.has(k) ? 'standard' : 'custom';
}
