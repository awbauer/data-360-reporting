import { useQuery } from '@tanstack/react-query';
import type { StandardDmo } from '@shared/standard-dmos';

export interface StandardIndex {
  keys: Set<string>;
  byKey: Map<string, StandardDmo>;
}

/** Salesforce's standard DMO index (1,554 objects), loaded once, on first use. */
export function useStandardDmos(): StandardIndex | null {
  const q = useQuery({
    queryKey: ['standard-dmos'],
    queryFn: async (): Promise<StandardIndex> => {
      const { STANDARD_DMOS } = await import('@shared/standard-dmos');
      return { keys: new Set(STANDARD_DMOS.map((d) => d.key)), byKey: new Map(STANDARD_DMOS.map((d) => [d.key, d])) };
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return q.data ?? null;
}
