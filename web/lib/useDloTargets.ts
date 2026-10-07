import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { MappingResult, ObjectMapping, ObjectMeta } from '@shared/types';
import { api } from '../api';
import { useWorkbench } from '../context';
import { resolveObject } from './names';

const CONCURRENCY = 5;
const STALE = 15 * 60_000;

/**
 * "Which data model objects does this DLO feed?" The Connect API can only list the mappings *into*
 * one DMO, so this walks every DMO in the data space. Results are cached per DMO under the same
 * keys the DMO pages use, so a second DLO page (or a DMO page) costs nothing. Calls are API
 * requests, not queries: they use no query credits, but they do count toward the org's API limits,
 * so the walk only starts when the user asks.
 */
export function useDloTargets(dlo: ObjectMeta) {
  const wb = useWorkbench();
  const qc = useQueryClient();
  const host = wb.session.instanceHost ?? '';
  const ds = wb.dataspace;
  const dmos = useMemo(() => wb.objects.filter((o) => o.kind === 'dmo'), [wb.objects]);
  const keyOf = useCallback((dmo: string) => ['mappings', host, ds, dmo] as const, [host, ds]);

  const [version, setVersion] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(0);
  const abort = useRef<AbortController | null>(null);

  // Whatever is already cached (from this walk, an earlier DLO, or a DMO page the user opened).
  const snapshot = useMemo(() => {
    void version;
    const results: { dmo: string; res: MappingResult }[] = [];
    let missing = 0;
    for (const d of dmos) {
      const res = qc.getQueryData<MappingResult>(keyOf(d.name));
      if (res) results.push({ dmo: d.name, res });
      else missing++;
    }
    return { results, missing };
  }, [dmos, qc, keyOf, version]);

  const targets = useMemo<ObjectMapping[]>(
    () =>
      snapshot.results.flatMap(({ res }) =>
        res.mappings.filter((m) => m.source === dlo.name || resolveObject(m.source, wb.byName, wb.objects)?.name === dlo.name),
      ),
    [snapshot, dlo.name, wb.byName, wb.objects],
  );

  const scan = useCallback(async () => {
    const ctl = (abort.current = new AbortController());
    const todo = dmos.filter((d) => !qc.getQueryData(keyOf(d.name)));
    let done = 0;
    let bad = 0;
    setFailed(0);
    setProgress({ done, total: todo.length });
    let next = 0;
    const worker = async () => {
      while (!ctl.signal.aborted) {
        const d = todo[next++];
        if (!d) return;
        try {
          await qc.fetchQuery({ queryKey: keyOf(d.name), queryFn: () => api.mappings(ds, d.name), staleTime: STALE });
        } catch {
          bad++;
        }
        setProgress({ done: ++done, total: todo.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    setFailed(bad);
    setProgress(null);
    setVersion((v) => v + 1);
  }, [dmos, qc, keyOf, ds]);

  const cancel = useCallback(() => abort.current?.abort(), []);

  return {
    targets,
    /** Every response gathered so far, for the raw-response view. */
    raw: snapshot.results.filter((r) => r.res.mappings.length).map((r) => ({ dmo: r.dmo, response: r.res.raw })),
    totalDmos: dmos.length,
    complete: dmos.length > 0 && snapshot.missing === 0,
    progress,
    failed,
    scan,
    cancel,
  };
}
