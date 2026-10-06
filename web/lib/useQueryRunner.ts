import { useCallback, useRef, useState } from 'react';
import type { CellValue, QueryColumn } from '@shared/types';
import { api, ApiError, type RunInput } from '../api';

export type Phase = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export interface RunState {
  phase: Phase;
  columns: QueryColumn[];
  rows: CellValue[][];
  rowCount: number;
  progress: number;
  queryId: string | null;
  dataspace: string;
  elapsedMs: number | null;
  error: string | null;
  loadingMore: boolean;
}

const INITIAL: RunState = {
  phase: 'idle', columns: [], rows: [], rowCount: 0, progress: 0, queryId: null, dataspace: 'default',
  elapsedMs: null, error: null, loadingMore: false,
};

const PAGE = 1000;
/** Keep the browser responsive: cap rows held in memory (CSV export streams from the server instead). */
export const MAX_IN_MEMORY = 50_000;

export function useQueryRunner(onFinished?: (input: RunInput, s: { rows: number; elapsedMs: number }) => void) {
  const [state, setState] = useState<RunState>(INITIAL);
  const latest = useRef(state);
  latest.current = state;
  const run = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const live = useRef<{ id: string; ds: string } | null>(null);

  const start = useCallback(
    async (input: RunInput) => {
      const myRun = ++run.current;
      abort.current?.abort();
      const ctl = (abort.current = new AbortController());
      const t0 = performance.now();
      setState({ ...INITIAL, phase: 'running', dataspace: input.dataspace });
      const current = () => run.current === myRun;
      try {
        const first = await api.submit(input);
        if (!current()) return;
        live.current = { id: first.queryId, ds: input.dataspace };
        setState((s) => ({
          ...s, columns: first.columns ?? [], rows: first.rows, rowCount: first.rowCount, progress: first.progress,
          queryId: first.queryId, phase: first.done ? 'done' : 'running',
          elapsedMs: first.done ? Math.round(performance.now() - t0) : null,
        }));
        let done = first.done;
        let rowCount = first.rowCount;
        while (!done) {
          const st = await api.status(first.queryId, input.dataspace, 8000, ctl.signal);
          if (!current()) return;
          done = st.done;
          rowCount = st.rowCount;
          setState((s) => ({ ...s, progress: st.progress, rowCount: st.rowCount }));
        }
        const elapsedMs = Math.round(performance.now() - t0);
        setState((s) => ({ ...s, phase: 'done', progress: 1, elapsedMs }));
        onFinished?.(input, { rows: rowCount, elapsedMs });
      } catch (e) {
        if (!current() || (e as Error).name === 'AbortError') return;
        setState((s) => ({ ...s, phase: 'error', error: e instanceof ApiError || e instanceof Error ? e.message : String(e) }));
      }
    },
    [onFinished],
  );

  const cancel = useCallback(() => {
    run.current++;
    abort.current?.abort();
    const q = live.current;
    if (q) void api.cancel(q.id, q.ds).catch(() => undefined);
    setState((s) => (s.phase === 'running' ? { ...s, phase: 'cancelled' } : s));
  }, []);

  const loadMore = useCallback(async () => {
    const q = live.current;
    if (!q) return;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const offset = latest.current.rows.length;
      const page = await api.rows(q.id, q.ds, offset, PAGE);
      setState((s) => ({ ...s, rows: s.rows.length === offset ? [...s.rows, ...page.rows] : s.rows, loadingMore: false }));
    } catch (e) {
      setState((s) => ({ ...s, loadingMore: false, error: (e as Error).message }));
    }
  }, []);

  const reset = useCallback(() => {
    run.current++;
    abort.current?.abort();
    live.current = null;
    setState(INITIAL);
  }, []);

  return { state, start, cancel, loadMore, reset };
}
