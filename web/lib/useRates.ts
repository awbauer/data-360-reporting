import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { changedRates, effectiveRates, sanitizeOverrides, type RateOverrides, type Rates } from '@shared/credits';
import { api } from '../api';

/**
 * The credit rates in force for this person: the shipped defaults plus whatever they changed,
 * kept on the server (per user, so it follows them between browsers). Nothing here is measured
 * from Salesforce; see shared/credits.ts.
 */
export function useRates() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['state', 'rates'], queryFn: () => api.getState<RateOverrides>('rates'), staleTime: Infinity, retry: 0 });
  const overrides = useMemo(() => sanitizeOverrides(q.data?.value), [q.data]);
  const rates: Rates = useMemo(() => effectiveRates(overrides), [overrides]);

  const save = useCallback(
    async (next: RateOverrides) => {
      const clean = sanitizeOverrides(next);
      qc.setQueryData(['state', 'rates'], { value: clean, updatedAt: Date.now() });
      await api.putState('rates', clean);
    },
    [qc],
  );

  return {
    loading: q.isLoading,
    overrides,
    rates,
    price: overrides.pricePerCredit,
    currency: overrides.currency ?? 'USD',
    confirmed: Boolean(overrides.confirmed),
    changed: changedRates(overrides),
    save,
  };
}
