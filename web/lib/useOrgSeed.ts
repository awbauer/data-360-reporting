import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { seedCandidates, type SeedCandidate } from '@shared/credits-seed';
import type { InsightDefinition } from '@shared/types';
import { api } from '../api';
import { useWorkbench } from '../context';
import { cachedCounts } from './storage';

/** Insight definitions are fetched for at most this many insights. */
export const MAX_INSIGHTS = 60;

/**
 * Activities the connected org already runs, as plan candidates: streams, identity resolution,
 * insights and segments, sized with the row counts cached in this browser. Metadata only, no
 * queries. Nothing is fetched until `enabled`.
 */
export function useOrgSeed(enabled: boolean, changeRate: number, countsVersion = '') {
  const wb = useWorkbench();
  const qc = useQueryClient();
  const host = wb.session.instanceHost ?? '';
  const extras = useQuery({ queryKey: ['extras', host, wb.dataspace], queryFn: () => api.extras(wb.dataspace), enabled });
  const insightObjects = useMemo(() => wb.objects.filter((o) => o.kind === 'ci').slice(0, MAX_INSIGHTS), [wb.objects]);
  const [insights, setInsights] = useState<InsightDefinition[] | null>(null);

  // Insight definitions, three at a time, through the same cache the Explorer uses.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const out: InsightDefinition[] = [];
    let next = 0;
    const worker = async () => {
      while (live && next < insightObjects.length) {
        const o = insightObjects[next++]!;
        try {
          out.push(await qc.fetchQuery({ queryKey: ['insight', host, o.name], queryFn: () => api.insight(o.name), staleTime: 15 * 60_000 }));
        } catch {
          /* a missing definition just leaves that insight unsized */
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]).then(() => live && setInsights(out));
    return () => {
      live = false;
    };
  }, [enabled, qc, host, insightObjects]);

  // Row counts live in localStorage; `countsVersion` changes when the caller counts more.
  const counts = useMemo(() => cachedCounts(host, wb.dataspace, wb.objects), [wb.objects, host, wb.dataspace, countsVersion]);
  const loading = enabled && (extras.isLoading || insights === null);
  const candidates = useMemo<SeedCandidate[]>(() => {
    if (!enabled || loading) return [];
    let n = 0;
    return seedCandidates({
      objects: wb.objects,
      extras: extras.data ?? null,
      insights: insights ?? [],
      counts,
      changeRate,
      // Stable ids, so choices survive a change of the change rate; callers make fresh ones to keep.
      newId: () => `seed-${n++}`,
    });
  }, [enabled, loading, wb.objects, extras.data, insights, counts, changeRate]);

  return {
    loading,
    candidates,
    counted: Object.keys(counts).length,
    objects: wb.objects.length,
    insightCount: insightObjects.length,
    extrasError: extras.error?.message ?? null,
    errors: extras.data?.errors ?? [],
  };
}
