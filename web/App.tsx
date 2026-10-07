import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, lazy, useEffect } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, NETWORK_ERROR, api, type SessionInfo } from './api';
import { UserMenu } from './components/UserMenu';
import { WorkbenchProvider, useWorkbench } from './context';
import { forgetLegacyData } from './lib/storage';
import { AdminPage } from './pages/Admin';
import { Connect } from './pages/Connect';
import { Explorer } from './pages/Explorer';
import { HistoryPage } from './pages/History';
import { LibraryPage } from './pages/Library';
import { Overview } from './pages/Overview';
import { SegmentsPage } from './pages/Segments';
import { NotAllowed, SignIn } from './pages/SignIn';

// The editor pulls in CodeMirror, so load it only when the Query page is opened.
const QueryPage = lazy(() => import('./pages/Query').then((m) => ({ default: m.QueryPage })));
const CreditsPage = lazy(() => import('./pages/Credits').then((m) => ({ default: m.CreditsPage })));

export function App() {
  const session = useQuery({ queryKey: ['session'], queryFn: api.session, staleTime: Infinity, retry: 1 });
  useEffect(() => forgetLegacyData(), []);
  if (session.isLoading) return <div className="hint">Loading…</div>;
  if (session.error || !session.data) {
    const offline = session.error instanceof ApiError && session.error.status === NETWORK_ERROR;
    return (
      <div className="hint" role="alert">
        {offline ? '' : 'The workbench can’t start: '}
        {session.error?.message ?? 'No response from the server.'}{' '}
        <button className="link" onClick={() => void session.refetch()}>Try again</button>
      </div>
    );
  }
  const s = session.data;
  if (!s.user) return <SignIn session={s} />;
  if (!s.user.allowed || s.user.blocked) return <NotAllowed session={s} />;
  if (!s.connected) {
    // Credit plans don't need an org: an estimate often comes before the org exists.
    return (
      <Routes>
        <Route path="/credits/:id?" element={<Standalone session={s} />} />
        <Route path="*" element={<Connect session={s} />} />
      </Routes>
    );
  }
  return (
    <WorkbenchProvider session={s}>
      <Shell />
    </WorkbenchProvider>
  );
}

/** The Credits page on its own, for someone signed in to the workbench but not to an org. */
function Standalone({ session }: { session: SessionInfo }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Data 360 Workbench</span>
        </div>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/credits">Credits</NavLink>
        </nav>
        <div className="grow" />
        <Link className="button" to="/">Connect an org</Link>
        <UserMenu session={session} />
      </header>
      <main className="main flush">
        <Suspense fallback={<div className="hint">Loading…</div>}><CreditsPage /></Suspense>
      </main>
    </div>
  );
}

function Shell() {
  const wb = useWorkbench();
  const qc = useQueryClient();

  const disconnect = async () => {
    await api.logout().catch(() => undefined);
    // Drop everything cached for this org, but keep the session query the app is observing.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    qc.setQueryData<SessionInfo>(['session'], (s) => (s ? { ...s, connected: false, instanceHost: null } : s));
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Data 360 Workbench</span>
        </div>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/overview">Overview</NavLink>
          <NavLink to="/explorer">Explorer</NavLink>
          <NavLink to="/segments">Segments</NavLink>
          <NavLink to="/query">Query</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/credits">Credits</NavLink>
          {wb.session.user?.admin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="grow" />
        <label className="row small" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <span className="ds-caption">Data space</span>
          <select value={wb.dataspace} onChange={(e) => wb.setDataspace(e.target.value)} aria-label="Data space">
            {wb.dataspaces.map((d) => (
              <option key={d.name} value={d.name}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <span className="badge host" title={`Connected org: ${wb.session.instanceHost}`}>{wb.session.instanceHost}</span>
        {wb.session.mock && <span className="badge mock">mock data</span>}
        <button onClick={disconnect} title="Disconnect from this Salesforce org">Disconnect</button>
        <UserMenu session={wb.session} />
      </header>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<main className="main"><Overview /></main>} />
        <Route path="/explorer/*" element={<main className="main flush"><Explorer /></main>} />
        <Route path="/segments" element={<main className="main"><SegmentsPage /></main>} />
        <Route path="/query" element={<main className="main flush"><Suspense fallback={<div className="hint">Loading editor…</div>}><QueryPage /></Suspense></main>} />
        <Route path="/library" element={<main className="main"><LibraryPage /></main>} />
        <Route path="/history" element={<main className="main"><HistoryPage /></main>} />
        <Route path="/credits/:id?" element={<main className="main flush"><Suspense fallback={<div className="hint">Loading…</div>}><CreditsPage /></Suspense></main>} />
        {wb.session.user?.admin && <Route path="/admin/*" element={<main className="main"><AdminPage /></main>} />}
        {wb.session.user?.admin && <Route path="/audit" element={<Navigate to="/admin/queries" replace />} />}
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </div>
  );
}
