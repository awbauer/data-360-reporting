import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { WorkbenchProvider, useWorkbench } from './context';
import { Connect } from './pages/Connect';
import { Explorer } from './pages/Explorer';
import { HistoryPage } from './pages/History';
import { LibraryPage } from './pages/Library';
import { Overview } from './pages/Overview';

// The editor pulls in CodeMirror, so load it only when the Query page is opened.
const QueryPage = lazy(() => import('./pages/Query').then((m) => ({ default: m.QueryPage })));

export function App() {
  const session = useQuery({ queryKey: ['session'], queryFn: api.session, staleTime: Infinity, retry: 1 });
  if (session.isLoading) return <div className="hint">Loading…</div>;
  if (session.error) return <div className="hint">Could not reach the server: {session.error.message}</div>;
  if (!session.data?.connected) return <Connect session={session.data!} />;
  return (
    <WorkbenchProvider session={session.data}>
      <Shell />
    </WorkbenchProvider>
  );
}

function Shell() {
  const wb = useWorkbench();
  const qc = useQueryClient();

  const disconnect = async () => {
    await api.logout().catch(() => undefined);
    // Drop everything cached for this org, but keep the session query the app is observing.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    qc.setQueryData(['session'], { connected: false, instanceHost: null, mock: wb.session.mock, defaultClientConfigured: true });
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Data 360 Workbench
        </div>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/overview">Overview</NavLink>
          <NavLink to="/explorer">Explorer</NavLink>
          <NavLink to="/query">Query</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
        <div className="grow" />
        <label className="row small" style={{ flexDirection: 'row', alignItems: 'center' }}>
          Data space
          <select value={wb.dataspace} onChange={(e) => wb.setDataspace(e.target.value)} aria-label="Data space">
            {wb.dataspaces.map((d) => (
              <option key={d.name} value={d.name}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <span className="badge" title="Connected org">{wb.session.instanceHost}</span>
        {wb.session.mock && <span className="badge mock">mock data</span>}
        <button onClick={disconnect}>Disconnect</button>
      </header>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<main className="main"><Overview /></main>} />
        <Route path="/explorer/*" element={<main className="main flush"><Explorer /></main>} />
        <Route path="/query" element={<main className="main flush"><Suspense fallback={<div className="hint">Loading editor…</div>}><QueryPage /></Suspense></main>} />
        <Route path="/library" element={<main className="main"><LibraryPage /></main>} />
        <Route path="/history" element={<main className="main"><HistoryPage /></main>} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </div>
  );
}
