import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import queries from 'virtual:query-library';
import type { LibraryEntry } from '@shared/types';
import { editUrl, LIBRARY_BRANCH, LIBRARY_REPO } from '../lib/github';
import type { QueryNavState } from './Query';

export function LibraryPage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tags = useMemo(() => [...new Set(queries.flatMap((e) => e.tags))].sort(), []);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return queries.filter(
      (e) =>
        (!tag || e.tags.includes(tag)) &&
        (!needle || `${e.title} ${e.description} ${e.id} ${e.sql}`.toLowerCase().includes(needle)),
    );
  }, [q, tag]);
  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0] ?? null;

  const open = (e: LibraryEntry) => {
    const state: QueryNavState = { sql: e.sql, paramDefs: e.params, ...(e.dataspace ? { dataspace: e.dataspace } : {}) };
    nav('/query', { state });
  };

  return (
    <div className="page">
      <div className="row wrap">
        <div className="grow">
          <h1>Query library</h1>
          <div className="muted small">
            Shared by everyone who uses this workbench. Add or change queries with a pull request to{' '}
            <a href={`https://github.com/${LIBRARY_REPO}`} target="_blank" rel="noreferrer">{LIBRARY_REPO}</a>{' '}
            (<code>queries/</code> on <code>{LIBRARY_BRANCH}</code>), or use “Propose to library” in the Query editor.
          </div>
        </div>
      </div>

      <div className="row wrap">
        <input type="search" placeholder="Search title, description, SQL…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} aria-label="Search library" />
        <div className="chips">
          {tags.map((t) => (
            <button key={t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? null : t)} aria-pressed={tag === t}>{t}</button>
          ))}
        </div>
      </div>

      {!queries.length && <div className="alert">The library is empty. Add <code>.sql</code> files under <code>queries/</code>.</div>}

      <div className="lib-grid">
        <div className="stack" style={{ gap: 8 }}>
          {filtered.map((e) => (
            <button key={e.id} className={`lib-item${selected?.id === e.id ? ' active' : ''}`} onClick={() => setSelectedId(e.id)}>
              <div className="title">{e.title}</div>
              <div className="muted small">{e.id}</div>
              {e.description && <div className="small" style={{ marginTop: 4 }}>{e.description}</div>}
              <div className="chips" style={{ marginTop: 6 }}>{e.tags.map((t) => <span className="badge" key={t}>{t}</span>)}</div>
            </button>
          ))}
          {queries.length > 0 && !filtered.length && <div className="muted">No queries match.</div>}
        </div>

        {selected && (
          <section className="card stack">
            <div className="row wrap">
              <h2 className="grow" style={{ margin: 0 }}>{selected.title}</h2>
              <a href={editUrl(selected.id)} target="_blank" rel="noreferrer"><button>Edit on GitHub</button></a>
              <button className="primary" onClick={() => open(selected)}>Open in editor</button>
            </div>
            {selected.description && <div>{selected.description}</div>}
            <pre className="sql">{selected.sql}</pre>
            {selected.params.length > 0 && (
              <table className="t">
                <thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Label</th></tr></thead>
                <tbody>
                  {selected.params.map((p) => (
                    <tr key={p.name}><td><code>:{p.name}</code></td><td>{p.type}</td><td>{p.default ?? ''}</td><td>{p.label ?? ''}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {selected.dataspace && <div className="small muted">Data space: <code>{selected.dataspace}</code></div>}
          </section>
        )}
      </div>
    </div>
  );
}
