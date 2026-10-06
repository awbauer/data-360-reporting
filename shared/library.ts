import { findParams } from './sql';
import type { LibraryEntry, ParamDef, ParamType } from './types';

export const PARAM_TYPES: ParamType[] = ['string', 'integer', 'number', 'boolean', 'date', 'timestamp'];

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

/** JSON text that is also valid YAML, and never contains a comment terminator. */
function yamlValue(v: unknown): string {
  return JSON.stringify(v).replace(/\*\//g, '*\\/');
}

/** Serialize an entry to the on-disk `queries/**\/*.sql` format. */
export function serializeLibraryFile(entry: Omit<LibraryEntry, 'id'>): string {
  const lines = ['/*---', `title: ${yamlValue(entry.title)}`];
  if (entry.description) lines.push(`description: ${yamlValue(entry.description)}`);
  if (entry.tags.length) lines.push(`tags: ${yamlValue(entry.tags)}`);
  if (entry.dataspace) lines.push(`dataspace: ${yamlValue(entry.dataspace)}`);
  if (entry.params.length) {
    lines.push('params:');
    for (const p of entry.params) {
      const o: Record<string, string> = { name: p.name, type: p.type };
      if (p.label) o.label = p.label;
      if (p.default !== undefined) o.default = p.default;
      lines.push(`  - ${yamlValue(o)}`);
    }
  }
  lines.push('---*/', '', entry.sql.trim(), '');
  return lines.join('\n');
}

/** Validate a parsed header + SQL. Returns a list of human-readable problems. */
export function validateEntry(entry: LibraryEntry): string[] {
  const errors: string[] = [];
  if (!ID_RE.test(entry.id)) errors.push(`id "${entry.id}" must be lowercase path segments (a-z, 0-9, ., _, -)`);
  if (!entry.title.trim()) errors.push('title is required');
  if (!entry.sql.trim()) errors.push('SQL body is empty');
  if (entry.tags.some((t) => !t.trim())) errors.push('tags must be non-empty strings');
  const seen = new Set<string>();
  for (const p of entry.params) {
    if (!NAME_RE.test(p.name)) errors.push(`param name "${p.name}" is invalid`);
    if (!PARAM_TYPES.includes(p.type)) errors.push(`param "${p.name}" has unknown type "${p.type}"`);
    if (seen.has(p.name)) errors.push(`param "${p.name}" is declared twice`);
    seen.add(p.name);
  }
  const used = new Set(findParams(entry.sql));
  for (const name of used) if (!seen.has(name)) errors.push(`:${name} is used in the SQL but not declared in params`);
  for (const name of seen) if (!used.has(name)) errors.push(`param "${name}" is declared but not used in the SQL`);
  return errors;
}

export function coerceParams(raw: unknown): ParamDef[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('params must be a list');
  return raw.map((p, i) => {
    if (typeof p !== 'object' || p === null) throw new Error(`params[${i}] must be a mapping`);
    const o = p as Record<string, unknown>;
    return {
      name: String(o.name ?? ''),
      type: String(o.type ?? 'string') as ParamType,
      ...(o.label !== undefined ? { label: String(o.label) } : {}),
      ...(o.default !== undefined ? { default: String(o.default) } : {}),
    };
  });
}
