import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { api, type LoginEvent } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { QUERY_CREDITS_PER_MILLION, creditsFor, fmtEstCredits, fmtRows } from '@shared/estimate';
import { fmtAgo, fmtNum } from '../lib/format';
import { AuditPage } from './Audit';

/** Admins only (AUTH_ADMIN_EMAILS): users, sign-ins, every query, and what admins did. */
export function AdminPage() {
  return (
    <div className="page">
      <div>
        <h1>Admin</h1>
        <nav className="subnav" aria-label="Admin">
          <NavLink to="/admin/users">Users</NavLink>
          <NavLink to="/admin/sign-ins">Sign-ins</NavLink>
          <NavLink to="/admin/queries">Queries</NavLink>
          <NavLink to="/admin/usage">Usage</NavLink>
          <NavLink to="/admin/actions">Admin log</NavLink>
        </nav>
      </div>
      <Routes>
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<Users />} />
        <Route path="users/:id" element={<UserDetail />} />
        <Route path="sign-ins" element={<SignIns />} />
        <Route path="queries" element={<AuditPage />} />
        <Route path="usage" element={<Usage />} />
        <Route path="actions" element={<Actions />} />
      </Routes>
    </div>
  );
}

const when = (ms: number | string | null) => (ms === null ? '' : new Date(ms).toLocaleString());
const ago = (ms: number | null) => (ms === null ? 'never' : fmtAgo(new Date(ms).toISOString()));

function Users() {
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: api.admin.users, staleTime: 0 });
  const [q, setQ] = useState('');
  const list = (users.data ?? []).filter((u) => !q || `${u.email} ${u.name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="row wrap">
        <div className="muted small grow">
          Everyone who has signed in. Blocking ends their sessions at once and refuses future sign-ins, whatever the allowlist says.
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by email or name" aria-label="Filter users" />
      </div>
      {users.error && <div className="alert error">{users.error.message}</div>}
      {users.isSuccess && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="t">
            <thead>
              <tr>
                <th>User</th><th>Signs in with</th><th>Last sign-in</th><th style={{ textAlign: 'right' }}>Sessions</th>
                <th style={{ textAlign: 'right' }}>Queries</th><th>Last query</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td><Link to={`/admin/users/${encodeURIComponent(u.id)}`}>{u.email}</Link><div className="muted small">{u.name}</div></td>
                  <td>{u.providers.join(', ')}</td>
                  <td title={when(u.lastSignInAt)}>{ago(u.lastSignInAt)}</td>
                  <td style={{ textAlign: 'right' }}>{u.activeSessions}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(u.queries)}</td>
                  <td title={when(u.lastQueryAt)}>{ago(u.lastQueryAt)}</td>
                  <td>{u.block ? <span className="badge bad" title={u.block.reason ?? undefined}>blocked</span> : <span className="muted">active</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function UserDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => api.admin.user(id), staleTime: 0 });
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin'] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (detail.isLoading) return <div className="hint">Loading…</div>;
  if (detail.error || !detail.data) return <div className="alert error">{detail.error?.message ?? 'Not found'}</div>;
  const { user, block, sessions, logins } = detail.data;

  return (
    <>
      <div><Link to="/admin/users">← All users</Link></div>
      <section className="card">
        <div className="row wrap">
          <div className="grow">
            <h2 style={{ margin: 0 }}>{user.email}</h2>
            <div className="muted small">
              {user.name} · joined {when(user.createdAt)}{user.admin ? ' · admin' : ''}
            </div>
          </div>
          <Link className="button" to={`/admin/queries?email=${encodeURIComponent(user.email)}`}>Their queries</Link>
          <button onClick={() => act.mutate(() => api.admin.revoke(user.id))} disabled={!sessions.length || act.isPending}>
            Sign out everywhere
          </button>
          {block ? (
            <button onClick={() => act.mutate(() => api.admin.unblock(user.id))} disabled={act.isPending}>Unblock</button>
          ) : (
            <button className="danger" onClick={() => setConfirmBlock(true)} disabled={user.admin || act.isPending}
              title={user.admin ? 'Remove them from AUTH_ADMIN_EMAILS first' : undefined}>
              Block…
            </button>
          )}
        </div>
        {block && (
          <div className="alert error small" style={{ marginTop: 12 }}>
            Blocked by {block.blockedBy} {fmtAgo(new Date(block.blockedAt).toISOString())}{block.reason ? `: ${block.reason}` : ''}.
          </div>
        )}
        {error && <div className="alert error small" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      </section>

      <section className="card">
        <h2>Active sessions ({sessions.length})</h2>
        {sessions.length ? (
          <table className="t">
            <thead><tr><th>Started</th><th>Expires</th><th>IP</th><th>Browser</th><th /></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{when(s.createdAt)}</td>
                  <td>{when(s.expiresAt)}</td>
                  <td className="mono">{s.ip ?? ''}</td>
                  <td className="small">{s.userAgent ?? ''}</td>
                  <td><button onClick={() => act.mutate(() => api.admin.revoke(user.id, s.id))} disabled={act.isPending}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="muted small">None.</div>
        )}
      </section>

      <section className="card">
        <h2>Sign-in history</h2>
        <LoginTable events={logins} showEmail={false} />
      </section>

      <ConfirmDialog
        open={confirmBlock}
        title={`Block ${user.email}?`}
        confirmLabel="Block"
        onCancel={() => setConfirmBlock(false)}
        onConfirm={() => {
          setConfirmBlock(false);
          act.mutate(() => api.admin.block(user.id, reason.trim()));
          setReason('');
        }}
      >
        <p style={{ marginTop: 0 }}>
          Their {sessions.length} active session(s) end now, and they can't sign in again until unblocked. Their saved credentials,
          tabs and query history are kept. Their Salesforce access is not affected outside this workbench.
        </p>
        <label>
          Reason (shown to other admins)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} placeholder="e.g. left the project" />
        </label>
      </ConfirmDialog>
    </>
  );
}

function LoginTable({ events, showEmail }: { events: LoginEvent[]; showEmail: boolean }) {
  if (!events.length) return <div className="muted small">Nothing recorded yet.</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="t">
        <thead>
          <tr><th>When</th>{showEmail && <th>Email</th>}<th>Outcome</th><th>Method</th><th>IP</th><th>Browser</th></tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{when(e.at)}</td>
              {showEmail && (
                <td>{e.userId ? <Link to={`/admin/users/${encodeURIComponent(e.userId)}`}>{e.email}</Link> : e.email}</td>
              )}
              <td style={e.outcome === 'success' ? undefined : { color: 'var(--bad)' }} title={e.reason ?? undefined}>
                {e.outcome}{e.reason ? <span className="muted small"> · {e.reason}</span> : null}
              </td>
              <td>{e.method ?? ''}</td>
              <td className="mono">{e.ip ?? ''}</td>
              <td className="small">{e.userAgent ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignIns() {
  const [outcome, setOutcome] = useState('');
  const events = useQuery({ queryKey: ['admin', 'logins', outcome], queryFn: () => api.admin.logins({ outcome }), staleTime: 0 });
  return (
    <>
      <div className="row wrap">
        <div className="muted small grow">
          Successful sign-ins, and attempts turned away by the allowlist or a block. IPs are as reported by Cloudflare (or the proxy in front of Node).
        </div>
        <label className="small row" style={{ flexDirection: 'row', alignItems: 'center' }}>
          Show
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
            <option value="">all</option>
            <option value="success">successful</option>
            <option value="denied">denied by the allowlist</option>
            <option value="blocked">blocked</option>
          </select>
        </label>
      </div>
      {events.error && <div className="alert error">{events.error.message}</div>}
      {events.data && <div className="card"><LoginTable events={events.data} showEmail /></div>}
    </>
  );
}

function Actions() {
  const actions = useQuery({ queryKey: ['admin', 'actions'], queryFn: api.admin.actions, staleTime: 0 });
  return (
    <>
      <div className="muted small">Every block, unblock and session revocation, and who did it.</div>
      {actions.error && <div className="alert error">{actions.error.message}</div>}
      {actions.data && !actions.data.length && <div className="alert">No admin actions yet.</div>}
      {actions.data && actions.data.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table className="t">
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>User</th><th>Detail</th></tr></thead>
            <tbody>
              {actions.data.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(a.at)}</td>
                  <td>{a.adminEmail}</td>
                  <td>{a.action}</td>
                  <td>{a.targetUserId ? <Link to={`/admin/users/${encodeURIComponent(a.targetUserId)}`}>{a.targetEmail}</Link> : a.targetEmail}</td>
                  <td className="small">{a.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Estimated query usage by person and org. A sizing aid for the engagement, not Salesforce's bill. */
function Usage() {
  const [days, setDays] = useState(30);
  const usage = useQuery({ queryKey: ['admin', 'usage', days], queryFn: () => api.admin.usage(days), staleTime: 0 });
  const rows = usage.data?.rows ?? [];
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  const totalRuns = sum((r) => r.runs);
  const totalEstimated = sum((r) => r.estimatedRuns);
  const totalCredits = creditsFor(sum((r) => r.estRows));
  return (
    <>
      <div className="row wrap">
        <div className="muted small grow">
          Query reads this workbench estimated, by person and org, at {QUERY_CREDITS_PER_MILLION} credits per million rows (the base Flex rate). It counts only queries run here:
          ingestion, unification, segmentation and activation are not visible to it, and a query reports no credits of its own. For what the
          org really consumed, by day and by resource, see Credits, Actual consumption (Salesforce's consumption feeds), or Digital Wallet.
        </div>
        <label className="small row" style={{ flexDirection: 'row', alignItems: 'center' }}>
          Last
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>
      {usage.error && <div className="alert error">{usage.error.message}</div>}
      {usage.isSuccess && !rows.length && <div className="alert">No queries in this period.</div>}
      {rows.length > 0 && (
        <>
          <div className="card">
            <b>{fmtEstCredits(totalCredits)} estimated credits</b> from {fmtNum(totalRuns)} queries in the last {days} days.{' '}
            <span className="muted small">
              {fmtNum(totalEstimated)} of them carried an estimate; the rest read objects nobody had counted yet, so this is a floor.
            </span>
          </div>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Person</th><th>Org</th><th style={{ textAlign: 'right' }}>Queries</th><th style={{ textAlign: 'right' }}>With estimate</th>
                  <th style={{ textAlign: 'right' }}>Est. rows read</th><th style={{ textAlign: 'right' }}>Est. credits</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const credits = creditsFor(r.estRows);
                  return (
                    <tr key={`${r.userEmail}|${r.instanceHost}`}>
                      <td>{r.userEmail}</td>
                      <td>{r.instanceHost}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(r.runs)}</td>
                      <td style={{ textAlign: 'right' }} title={r.partialRuns ? `${r.partialRuns} of these are lower bounds` : undefined}>{fmtNum(r.estimatedRuns)}{r.partialRuns ? '*' : ''}</td>
                      <td style={{ textAlign: 'right' }}>{fmtRows(r.estRows)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtEstCredits(credits)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.some((r) => r.partialRuns > 0) && <div className="small muted">* includes runs whose estimate is a lower bound (an object in the query had never been counted).</div>}
        </>
      )}
    </>
  );
}
