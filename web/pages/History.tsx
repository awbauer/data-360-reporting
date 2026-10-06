import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtAgo, fmtMs, fmtNum } from '../lib/format';
import { history } from '../lib/storage';
import type { QueryNavState } from './Query';

export function HistoryPage() {
  const nav = useNavigate();
  const [items, setItems] = useState(() => history.list());

  return (
    <div className="page">
      <div className="row">
        <div className="grow">
          <h1>History</h1>
          <div className="muted small">Your last runs, stored only in this browser.</div>
        </div>
        <button onClick={() => { history.clear(); setItems([]); }} disabled={!items.length}>Clear history</button>
      </div>
      {!items.length && <div className="alert">No queries run yet.</div>}
      <div className="stack" style={{ gap: 8 }}>
        {items.map((h) => (
          <div className="card" key={h.id}>
            <div className="row wrap" style={{ marginBottom: 8 }}>
              <span className="muted small grow">
                {fmtAgo(h.at)} · {h.dataspace} · {fmtNum(h.rows)} rows · {fmtMs(h.elapsedMs)}
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
            <pre className="sql" style={{ maxHeight: 140 }}>{h.sql}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
