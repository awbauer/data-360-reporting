import { objectKey } from '@shared/dmo-names';
import type { ObjectMeta } from '@shared/types';

const bare = (n: string) => n.replace(/__(dlm|dll|cio)$/i, '').toLowerCase();

/**
 * Finds a metadata object for a name another endpoint returned. Mapping responses may use
 * developer names without the `__dlm` / `__dll` suffix (unconfirmed), so fall back to that.
 */
export function resolveObject(name: string, byName: Map<string, ObjectMeta>, objects: ObjectMeta[]): ObjectMeta | undefined {
  const exact = byName.get(name) ?? objects.find((o) => bare(o.name) === bare(name));
  if (exact) return exact;
  // Across name generations (ssot__X__dlm vs a standard X_std__dlm), when only one object fits.
  const k = objectKey(name);
  const hits = objects.filter((o) => objectKey(o.name) === k);
  return hits.length === 1 ? hits[0] : undefined;
}

/** Pretty-prints criteria that are JSON (sometimes JSON inside a JSON string); otherwise returns the text. */
export function prettyCriteria(text: string): string {
  try {
    let v: unknown = JSON.parse(text);
    if (typeof v === 'string') v = JSON.parse(v);
    return JSON.stringify(v, null, 2);
  } catch {
    return text;
  }
}
