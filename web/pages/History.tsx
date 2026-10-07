import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { creditsFor, fmtCredits } from '@shared/credits';
import { fmtAgo, fmtMs, fmtNum } from '../lib/format';
import { useRates } from '../lib/useRates';
import type { QueryNavState } from './Query';

export function HistoryPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ['history'], queryFn: api.history, staleTime: 0 });
  const clear = useMutation({
    mutationFn: api.clearHistory,
    onSuccess: () => qc.setQueryData(['history'], []),
  });
  const list = items.data ?? [];
  const { rates } = useRates();

  return (
    <div className="page">
      <div className="row">
        <div className="grow">
          <h1>History</h1>
          <div className="muted small">
            Your last runs from the editor, on any device. Clearing hides them here; the audit log keeps them.
          </div>
        </div>
        <button onClick={() => clear.mutate()} disabled={!list.length || clear.isPending}>Clear history</button>
      </div>
      {items.isLoading && <div className="hint">Loading…</div>}
      {items.error && <div className="alert error">{items.error.message}</div>}
      {items.isSuccess && !list.length && <div className="alert">No queries run yet.</div>}
      <div className="stack" style={{ gap: 8 }}>
        {list.map((h) => (
          <div className="card" key={h.id}>
            <div className="row wrap" style={{ marginBottom: 8 }}>
              <span className="muted small grow">
                {fmtAgo(h.at)} · {h.instanceHost} · {h.dataspace}
                {h.status === 'done' && h.rows !== null && <> · {fmtNum(h.rows)} rows</>}
                {h.elapsedMs !== null && <> · {fmtMs(h.elapsedMs)}</>}
                {h.estRows !== null && (
                  <span title="Estimated from cached row counts when it ran, at your current rate. Not a measurement.">
                    {' '}· est. {h.estComplete ? '≈' : '≥'} {fmtCredits(creditsFor(h.estRows, rates.query))} credits
                  </span>
                )}
                {h.status !== 'done' && <> · <span style={h.status === 'failed' ? { color: 'var(--bad)' } : undefined}>{h.status}</span></>}
              </span>
              <button onClick={() => {
                const state: QueryNavState = { sql: h.sql, dataspace: h.dataspace, paramDefs: h.paramDefs, params: h.params };
                nav('/query', { state });
              }}>Open in editor</button>
              <button className="primary" onClick={() => {
                const state: QueryNavState = { sql: h.sql, dataspace: h.dataspace, paramDefs: h.paramDefs, params: h.params, autorun: true };
                nav('/query', { state });
              }}>Run again</button>
            </div>
            {h.error && <div className="alert error small" style={{ marginBottom: 8 }}>{h.error}</div>}
            <pre className="sql" style={{ maxHeight: 140 }}>{h.sql}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
