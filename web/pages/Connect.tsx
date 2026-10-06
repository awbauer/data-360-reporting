import { useEffect, useState } from 'react';
import { api, ApiError, type SessionInfo } from '../api';
import { savedCredentials, type SavedCredentials } from '../lib/storage';

type Env = 'production' | 'sandbox' | 'custom';

/** The connection is only started by an explicit click; nothing redirects on load. */
export function Connect({ session }: { session: SessionInfo }) {
  const [env, setEnv] = useState<Env>('production');
  const [domain, setDomain] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<SavedCredentials | null>(() => savedCredentials.get());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const e = url.searchParams.get('error');
    if (e) {
      setError(e);
      url.searchParams.delete('error');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, []);

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!session.mock) {
        // The user's own credentials go to the server first (never in the URL); it parks them in a
        // short-lived sealed cookie that the login redirect picks up.
        if (saved) {
          await api.credentials({ saved: saved.saved });
        } else if (clientId.trim()) {
          const res = await api.credentials({
            clientId: clientId.trim(),
            ...(clientSecret ? { clientSecret } : {}),
            remember,
          });
          if (res.saved) savedCredentials.set({ clientId: res.clientId, saved: res.saved });
        }
        setClientSecret('');
      }
      const q = new URLSearchParams({ env });
      if (env === 'custom') q.set('domain', domain.trim());
      window.location.assign(`/auth/login?${q}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'saved_unreadable') {
        savedCredentials.clear();
        setSaved(null);
      }
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const forget = () => {
    savedCredentials.clear();
    setSaved(null);
  };

  const hasClient = session.defaultClientConfigured || Boolean(saved) || clientId.trim().length > 0;
  const canConnect = !busy && (session.mock || ((env !== 'custom' || domain.trim().length > 3) && hasClient));

  return (
    <div className="connect">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (canConnect) void connect();
        }}
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Data 360 Workbench
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Browse metadata, profile data and run SQL against a Data 360 org. You sign in with Salesforce; nothing is
          stored about your org on the server. Sign-in uses OAuth with PKCE, so no client secret is needed.
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
            <details open={Boolean(saved) || !session.defaultClientConfigured}>
              <summary>Your own External Client App{session.defaultClientConfigured ? ' (optional)' : ''}</summary>
              <div className="alert small" style={{ marginTop: 10 }}>
                <b>Recommended: PKCE, no secret.</b> Sign-in always uses PKCE. In your External Client App, enable the
                authorization-code flow, require PKCE, turn off “Require secret for Web Server flow”, and add the
                callback URL <code>{window.location.origin}/auth/callback</code> with scopes <code>api</code>,{' '}
                <code>refresh_token</code>, <code>cdp_query_api</code> and <code>cdp_profile_api</code>. Then paste just
                the consumer key. An app only authorizes the org that owns it, so use each org's own key.
              </div>
              {saved ? (
                <div className="stack" style={{ marginTop: 10 }}>
                  <div className="alert">
                    Using the credentials saved on this device: <code>{saved.clientId}</code>. The secret is stored
                    encrypted; only this server can decrypt it.
                  </div>
                  <div><button type="button" onClick={forget}>Forget and enter different credentials</button></div>
                </div>
              ) : (
                <div className="stack" style={{ marginTop: 10 }}>
                  <label>
                    Consumer key
                    <input
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder={session.defaultClientConfigured ? 'Leave empty to use the shared app' : 'Required'}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    Consumer secret (optional, not recommended)
                    <input
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="Leave empty to sign in with PKCE"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 13 }}>
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={!clientId.trim()} style={{ width: 'auto' }} />
                    Remember on this device (secret encrypted)
                  </label>
                  {clientSecret && (
                    <div className="alert warn small" role="note">
                      A secret is less safe than PKCE alone. If your app lets you, turn off “Require secret for Web
                      Server flow” and leave this empty.
                    </div>
                  )}
                  <p className="small muted" style={{ margin: 0 }}>
                    Used only for your sign-in. The secret is held in an encrypted session cookie and is never put in a
                    URL or stored on the server. If you remember it, the browser keeps only ciphertext that this server
                    can decrypt.
                  </p>
                </div>
              )}
            </details>
          </>
        )}
        <button className="primary" type="submit" disabled={!canConnect}>
          {session.mock ? 'Start with sample data' : busy ? 'Connecting…' : 'Connect to Salesforce'}
        </button>
      </form>
    </div>
  );
}
