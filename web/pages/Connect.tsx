import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type SessionInfo } from '../api';
import { UserMenu } from '../components/UserMenu';
import { useUrlError } from './SignIn';

type Env = 'production' | 'sandbox' | 'custom';

/** The connection is only started by an explicit click; nothing redirects on load. */
export function Connect({ session }: { session: SessionInfo }) {
  const [env, setEnv] = useState<Env>('production');
  const [domain, setDomain] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [label, setLabel] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useUrlError();
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const savedList = useQuery({ queryKey: ['credentials'], queryFn: api.savedCredentials, enabled: !session.mock });
  const list = savedList.data ?? [];
  // '' = type new ones (or use the shared app); otherwise the id of a saved entry.
  const [savedId, setSavedId] = useState('');
  useEffect(() => {
    if (list.length && !savedId) setSavedId(list[0]!.id);
  }, [list, savedId]);
  const saved = list.find((c) => c.id === savedId) ?? null;
  const remove = useMutation({
    mutationFn: api.deleteCredential,
    onSuccess: () => {
      setSavedId('');
      void qc.invalidateQueries({ queryKey: ['credentials'] });
    },
  });

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!session.mock) {
        // The user's own credentials go to the server first (never in the URL); it parks them in a
        // short-lived sealed cookie that the login redirect picks up.
        if (saved) {
          await api.credentials({ savedId: saved.id });
        } else if (clientId.trim()) {
          await api.credentials({
            clientId: clientId.trim(),
            ...(clientSecret ? { clientSecret } : {}),
            ...(label.trim() ? { label: label.trim() } : {}),
            remember,
          });
        }
        setClientSecret('');
      }
      const q = new URLSearchParams({ env });
      if (env === 'custom') q.set('domain', domain.trim());
      window.location.assign(`/auth/login?${q}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
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
        <div className="row">
          <div className="brand grow">
            <span className="brand-mark" aria-hidden />
            Data 360 Workbench
          </div>
          <UserMenu session={session} />
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Browse metadata, profile data and run SQL against a Data 360 org. Connect with your Salesforce login: queries
          run as you, with your permissions, and each one is recorded against your workbench account. Your Salesforce
          tokens stay in an encrypted cookie in this browser, never in the server's database. Sign-in uses OAuth with
          PKCE, so no client secret is needed.
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
            <details open={list.length > 0 || !session.defaultClientConfigured}>
              <summary>Your own External Client App{session.defaultClientConfigured ? ' (optional)' : ''}</summary>
              <div className="alert small" style={{ marginTop: 10 }}>
                <b>Recommended: PKCE, no secret.</b> Sign-in always uses PKCE. In your External Client App, enable the
                authorization-code flow, require PKCE, turn off “Require secret for Web Server flow”, and add the
                callback URL <code>{window.location.origin}/auth/callback</code> with scopes <code>api</code>,{' '}
                <code>refresh_token</code>, <code>cdp_query_api</code> and <code>cdp_profile_api</code>. Then paste just
                the consumer key. An app only authorizes the org that owns it, so use each org's own key.
              </div>
              {list.length > 0 && (
                <label style={{ marginTop: 10 }}>
                  Saved to your account
                  <select value={savedId} onChange={(e) => setSavedId(e.target.value)}>
                    {list.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} ({c.clientId.slice(0, 10)}…{c.hasSecret ? ', with secret' : ''})
                      </option>
                    ))}
                    <option value="">Enter different credentials…</option>
                  </select>
                </label>
              )}
              {saved ? (
                <div className="stack" style={{ marginTop: 10 }}>
                  <div className="alert small">
                    Using <b>{saved.label}</b>: <code>{saved.clientId}</code>.
                    {saved.hasSecret && ' Its secret is stored encrypted and is only decrypted for your sign-in.'}
                  </div>
                  <div>
                    <button type="button" onClick={() => remove.mutate(saved.id)} disabled={remove.isPending}>
                      Delete these saved credentials
                    </button>
                  </div>
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
                    Save to my account{clientSecret ? ' (secret encrypted)' : ''}
                  </label>
                  {remember && (
                    <label>
                      Name
                      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme production" maxLength={80} />
                    </label>
                  )}
                  {clientSecret && (
                    <div className="alert warn small" role="note">
                      A secret is less safe than PKCE alone. If your app lets you, turn off “Require secret for Web
                      Server flow” and leave this empty.
                    </div>
                  )}
                  <p className="small muted" style={{ margin: 0 }}>
                    Used only for your sign-in and never put in a URL. If you save them, the secret is encrypted with the
                    server's key and bound to your account, so the database alone can't reveal it.
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
