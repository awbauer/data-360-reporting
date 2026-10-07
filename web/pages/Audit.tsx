import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type AuditEntry } from '../api';
import { fmtMs, fmtNum } from '../lib/format';

const PAGE = 200;

/** Admins only (AUTH_ADMIN_EMAILS): every query run through the workbench, by whom, against which org. */
export function AuditPage() {
  // Linked from a user's admin page as ?email=.
  const [params] = useSearchParams();
  const initialEmail = params.get('email') ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [host, setHost] = useState('');
  const [filter, setFilter] = useState<{ email?: string; host?: string }>(initialEmail ? { email: initialEmail } : {});
  const [open, setOpen] = useState<string | null>(null);

  const log = useInfiniteQuery({
    queryKey: ['audit', filter],
    queryFn: ({ pageParam }) => api.audit({ ...filter, ...(pageParam ? { before: pageParam } : {}) }),
    initialPageParam: 0,
    getNextPageParam: (last: AuditEntry[]) => (last.length >= PAGE ? last[last.length - 1]!.startedAt : undefined),
    staleTime: 0,
  });
  const rows = log.data?.pages.flat() ?? [];

  return (
    <>
      <div className="row wrap">
        <div className="grow">
          <h2 style={{ margin: 0 }}>Audit log</h2>
          <div className="muted small">
            Every query run through the workbench, recorded before it reaches Salesforce. Salesforce runs each one as the
            user who connected; the org and user ids below come from their token.
          </div>
        </div>
        <a className="button" href={api.auditCsvUrl(filter)} download>Download CSV</a>
      </div>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...(email.trim() ? { email: email.trim() } : {}), ...(host.trim() ? { host: host.trim() } : {}) });
        }}
      >
        <label className="small">User email <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="anyone" /></label>
        <label className="small">Org host <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="any org" /></label>
        <button type="submit">Filter</button>
      </form>
      {log.error && <div className="alert error">{log.error.message}</div>}
      {log.isSuccess && !rows.length && <div className="alert">Nothing recorded yet.</div>}
      {rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="t">
            <thead>
              <tr>
                <th>When</th><th>User</th><th>Org</th><th>Data space</th><th>From</th><th>Status</th>
                <th style={{ textAlign: 'right' }}>Rows</th><th style={{ textAlign: 'right' }}>Time</th><th>SQL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>{r.userEmail}</td>
                  <td title={[r.sfOrgId && `Org ${r.sfOrgId}`, r.sfUserId && `Salesforce user ${r.sfUserId}`].filter(Boolean).join(' · ')}>{r.instanceHost}</td>
                  <td>{r.dataspace}</td>
                  <td>{r.source}</td>
                  <td style={r.status === 'failed' ? { color: 'var(--bad)' } : undefined} title={r.error ?? undefined}>{r.status}</td>
                  <td style={{ textAlign: 'right' }}>{r.rowCount === null ? '' : fmtNum(r.rowCount)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r.finishedAt ? fmtMs(r.finishedAt - r.startedAt) : ''}</td>
                  <td style={{ maxWidth: 480 }}>
                    <button className="link" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                      <code>{r.sql.length > 80 && open !== r.id ? `${r.sql.slice(0, 79)}…` : open === r.id ? 'Hide' : r.sql}</code>
                    </button>
                    {open === r.id && (
                      <>
                        <pre className="sql" style={{ maxHeight: 240 }}>{r.sql}</pre>
                        {Object.keys(r.params).length > 0 && <div className="small muted">Params: <code>{JSON.stringify(r.params)}</code></div>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log.hasNextPage && (
        <div><button onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage}>Load older</button></div>
      )}
    </>
  );
}
