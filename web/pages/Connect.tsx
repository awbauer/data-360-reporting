import { useEffect, useState } from 'react';
import type { SessionInfo } from '../api';

type Env = 'production' | 'sandbox' | 'custom';

/** The connection is only started by an explicit click; nothing redirects on load. */
export function Connect({ session }: { session: SessionInfo }) {
  const [env, setEnv] = useState<Env>('production');
  const [domain, setDomain] = useState('');
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const e = url.searchParams.get('error');
    if (e) {
      setError(e);
      url.searchParams.delete('error');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, []);

  const connect = () => {
    const q = new URLSearchParams({ env });
    if (env === 'custom') q.set('domain', domain.trim());
    if (clientId.trim()) q.set('clientId', clientId.trim());
    window.location.assign(`/auth/login?${q}`);
  };

  const canConnect = session.mock || ((env !== 'custom' || domain.trim().length > 3) && (session.defaultClientConfigured || clientId.trim().length > 0));

  return (
    <div className="connect">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (canConnect) connect();
        }}
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Data 360 Workbench
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Browse metadata, profile data and run SQL against a Data 360 org. You sign in with Salesforce; nothing is
          stored about your org on the server.
        </p>
        {error && <div className="alert error" role="alert">{error}</div>}
        {session.mock ? (
          <div className="alert warn">Mock mode: the app is serving sample data, no Salesforce org is needed.</div>
        ) : (
          <>
            <div className="choice" role="radiogroup" aria-label="Org type">
              {(['production', 'sandbox', 'custom'] as const).map((v) => (
                <label key={v}>
                  <input type="radio" name="env" checked={env === v} onChange={() => setEnv(v)} />
                  {v === 'production' ? 'Production' : v === 'sandbox' ? 'Sandbox' : 'My Domain'}
                </label>
              ))}
            </div>
            {env === 'custom' && (
              <label>
                My Domain host
                <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.my.salesforce.com" autoFocus />
              </label>
            )}
            <details>
              <summary>Advanced</summary>
              <label style={{ marginTop: 10 }}>
                Consumer key (optional{session.defaultClientConfigured ? '' : ', required'})
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Use this org's own External Client App" />
              </label>
              <p className="small muted">
                An External Client App only authorizes the org that owns it. To connect another org, install an app there
                and paste its consumer key. It signs in with PKCE, so no secret is needed.
              </p>
            </details>
          </>
        )}
        <button className="primary" type="submit" disabled={!canConnect}>
          {session.mock ? 'Start with sample data' : 'Connect to Salesforce'}
        </button>
      </form>
    </div>
  );
}
