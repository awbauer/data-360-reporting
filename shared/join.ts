import { quoteIdent } from './sql';
import type { FieldMeta, ObjectMeta, Relationship } from './types';

const MAX_PER_SIDE = 5;

/** Join keys first, then primary keys, then ordinary fields; key-qualifier plumbing last. */
function pickFields(obj: ObjectMeta, joinField: string): FieldMeta[] {
  const rank = (f: FieldMeta) => (f.name === joinField ? 0 : f.isPk ? 1 : f.name.startsWith('KQ_') || f.keyQualifier ? 3 : 2);
  return [...obj.fields].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_PER_SIDE);
}

/**
 * A runnable JOIN for one relationship, or null when either side's fields are unknown (e.g. the
 * related object isn't visible in this data space). Columns are aliased "a.field" / "b.field" so
 * same-named fields on both sides stay distinct in the results.
 */
export function buildJoinSql(from: ObjectMeta, to: ObjectMeta, rel: Relationship, limit = 100): string | null {
  const fa = rel.fromEntityAttribute;
  const ta = rel.toEntityAttribute;
  if (!fa || !ta) return null;
  if (!from.fields.some((f) => f.name === fa) || !to.fields.some((f) => f.name === ta)) return null;
  const cols = [
    ...pickFields(from, fa).map((f) => `  a.${quoteIdent(f.name)} AS ${quoteIdent(`a.${f.name}`)}`),
    ...pickFields(to, ta).map((f) => `  b.${quoteIdent(f.name)} AS ${quoteIdent(`b.${f.name}`)}`),
  ];
  return (
    `SELECT\n${cols.join(',\n')}\n` +
    `FROM ${quoteIdent(from.name)} a\n` +
    `JOIN ${quoteIdent(to.name)} b ON a.${quoteIdent(fa)} = b.${quoteIdent(ta)}\n` +
    `LIMIT ${Math.max(1, Math.floor(limit))}`
  );
}

export interface Edge {
  other: string;
  /** Relationships between the focus object and `other`. */
  rels: Relationship[];
}

/** Distinct neighbours of `name`, merging parallel relationships. Self-relationships are skipped. */
export function neighbours(name: string, rels: Relationship[]): Edge[] {
  const by = new Map<string, Relationship[]>();
  for (const r of rels) {
    const other = r.fromEntity === name ? r.toEntity : r.fromEntity;
    if (other === name || (r.fromEntity !== name && r.toEntity !== name)) continue;
    const list = by.get(other) ?? [];
    if (!list.some((x) => x.fromEntity === r.fromEntity && x.fromEntityAttribute === r.fromEntityAttribute && x.toEntityAttribute === r.toEntityAttribute)) list.push(r);
    by.set(other, list);
  }
  return [...by].map(([other, list]) => ({ other, rels: list })).sort((a, b) => a.other.localeCompare(b.other));
}

export function cardinalityText(c?: string): string {
  switch ((c ?? '').toUpperCase()) {
    case 'NTOONE':
      return 'N:1';
    case 'ONETOONE':
      return '1:1';
    case 'ONETON':
      return '1:N';
    case 'NTON':
    case 'NTOMANY':
      return 'N:N';
    default:
      return c ?? '';
  }
}
