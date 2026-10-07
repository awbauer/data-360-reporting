import { useMemo, useSyncExternalStore } from 'react';
import { creditsFor } from '@shared/credits';
import { estimateScan } from '@shared/estimate';
import { useWorkbench } from '../context';
import { getCountsVersion, knownRows, subscribeCounts } from './storage';
import { useRates } from './useRates';

/**
 * What a query would read, from row counts this browser already has (so estimating is free). It
 * updates when counts change elsewhere, e.g. after counting an object in the Explorer.
 */
export function useScanEstimate(sql: string) {
  const wb = useWorkbench();
  const { rates, price, currency } = useRates();
  const host = wb.session.instanceHost ?? '';
  const version = useSyncExternalStore(subscribeCounts, getCountsVersion);
  const estimate = useMemo(
    () => (sql.trim() ? estimateScan(sql, wb.byName, (n) => knownRows(host, wb.dataspace, n)) : null),
    // `version` is the cache's change counter: counts are read from storage, not React state.
    [sql, wb.byName, host, wb.dataspace, version],
  );
  return { estimate, credits: estimate ? creditsFor(estimate.rows, rates.query) : null, view: { rate: rates.query, price, currency } };
}
