import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObjectMeta } from '@shared/types';
import { buildRowCountSql } from '@shared/sql';
import { ApiError, runToCompletion } from '../api';
import { countCache, type CachedCount } from './storage';

const CONCURRENCY = 3;

/** Cached per-object row counts plus a cancellable, bounded-concurrency scan. */
export function useRowCounts(host: string, dataspace: string, objects: ObjectMeta[]) {
  const [counts, setCounts] = useState<Record<string, CachedCount>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const next: Record<string, CachedCount> = {};
    for (const o of objects) {
      const c = countCache.get(host, dataspace, o.name);
      if (c) next[o.name] = c;
    }
    setCounts(next);
  }, [host, dataspace, objects]);

  const countOne = useCallback(
    async (name: string, signal?: AbortSignal) => {
      const res = await runToCompletion({ sql: buildRowCountSql({ name }), dataspace, source: 'overview' }, { signal, maxRows: 1 });
      const rows = Number(res.rows[0]?.[0] ?? 0);
      const entry = { rows, at: new Date().toISOString() };
      countCache.set(host, dataspace, name, entry);
      setCounts((c) => ({ ...c, [name]: entry }));
    },
    [host, dataspace],
  );

  const scan = useCallback(
    async (targets: ObjectMeta[]) => {
      const ctl = new AbortController();
      abort.current = ctl;
      setError(null);
      setProgress({ done: 0, total: targets.length });
      let next = 0;
      let done = 0;
      const failures: string[] = [];
      const worker = async () => {
        while (!ctl.signal.aborted) {
          const o = targets[next++];
          if (!o) return;
          try {
            await countOne(o.name, ctl.signal);
          } catch (e) {
            if ((e as Error).name === 'AbortError') return;
            if (e instanceof ApiError && e.code === 'not_connected') {
              ctl.abort();
              return;
            }
            failures.push(`${o.name}: ${(e as Error).message}`);
          }
          setProgress({ done: ++done, total: targets.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
      setProgress(null);
      abort.current = null;
      if (failures.length) setError(`${failures.length} object(s) could not be counted. First: ${failures[0]}`);
    },
    [countOne],
  );

  return { counts, progress, error, scan, cancel: () => abort.current?.abort(), countOne };
}
