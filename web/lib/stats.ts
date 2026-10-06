import type { ObjectMeta } from '@shared/types';

export interface OverviewStats {
  counts: { dmo: number; dlo: number; ci: number };
  dmoByCategory: [string, number][];
  totalFields: number;
  relationships: number;
  typeMix: [string, number][];
  mostConnected: { name: string; label: string; neighbors: number }[];
  /** DMOs with no relationships at all: often unmapped or orphaned models. */
  isolated: ObjectMeta[];
}

const sortDesc = (m: Map<string, number>): [string, number][] => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** Everything here derives from metadata alone, so it costs no query credits. */
export function computeOverview(objects: ObjectMeta[]): OverviewStats {
  const byCategory = new Map<string, number>();
  const types = new Map<string, number>();
  const neighbors = new Map<string, Set<string>>();
  const relKeys = new Set<string>();
  const counts = { dmo: 0, dlo: 0, ci: 0 };
  let totalFields = 0;

  for (const o of objects) {
    counts[o.kind]++;
    if (o.kind === 'dmo') byCategory.set(o.category, (byCategory.get(o.category) ?? 0) + 1);
    totalFields += o.fields.length;
    for (const f of o.fields) types.set(f.type, (types.get(f.type) ?? 0) + 1);
    for (const r of o.relationships) {
      relKeys.add([r.fromEntity, r.toEntity, r.fromEntityAttribute ?? '', r.toEntityAttribute ?? ''].join('|'));
      if (r.fromEntity !== r.toEntity) {
        for (const [a, b] of [[r.fromEntity, r.toEntity], [r.toEntity, r.fromEntity]] as const) {
          (neighbors.get(a) ?? neighbors.set(a, new Set()).get(a)!).add(b);
        }
      }
    }
  }

  const label = new Map(objects.map((o) => [o.name, o.label]));
  const mostConnected = [...neighbors]
    .filter(([name]) => label.has(name))
    .map(([name, set]) => ({ name, label: label.get(name)!, neighbors: set.size }))
    .sort((a, b) => b.neighbors - a.neighbors || a.name.localeCompare(b.name))
    .slice(0, 8);

  return {
    counts,
    dmoByCategory: sortDesc(byCategory),
    totalFields,
    relationships: relKeys.size,
    typeMix: sortDesc(types),
    mostConnected,
    isolated: objects.filter((o) => o.kind === 'dmo' && !neighbors.has(o.name)),
  };
}
