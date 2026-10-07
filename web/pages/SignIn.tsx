import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { appAuth, type Provider, type SessionInfo } from '../api';
import { useSignOut } from '../components/UserMenu';

const PROVIDER_LABEL: Record<Provider, string> = { github: 'Continue with GitHub', google: 'Continue with Google' };

/** Better Auth reports sign-in failures as /?error=<code>. */
const ERRORS: Record<string, string> = {
  unable_to_create_user: "That account isn't on this workbench's allowlist. Ask its administrator to add your email or domain.",
  not_allowed: "That account isn't on this workbench's allowlist. Ask its administrator to add your email or domain.",
  blocked: 'Your access to this workbench has been suspended by an administrator.',
  account_not_linked: 'An account with that email already exists with another provider. Sign in with that one.',
  state_mismatch: 'The sign-in took too long or was started in another tab. Try again.',
  please_restart_the_process: 'The sign-in took too long or was started in another tab. Try again.',
};

/** Reads and removes ?error= from the URL once. */
export function useUrlError(): [string | null, (e: string | null) => void] {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const e = url.searchParams.get('error');
    if (e) {
      setError(ERRORS[e] ?? e.replace(/_/g, ' '));
      url.searchParams.delete('error');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, []);
  return [error, setError];
}

export function SignIn({ session }: { session: SessionInfo }) {
  const qc = useQueryClient();
  const [error, setError] = useUrlError();
  const [busy, setBusy] = useState(false);

  const go = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="connect">
      <div className="card">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Data 360 Workbench
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Sign in to the workbench first; you connect to a Salesforce org on the next step. Every query you run is
          recorded against your account.
        </p>
        {error && <div className="alert error" role="alert">{error}</div>}
        {session.providers.map((p) => (
          <button key={p} className="primary" disabled={busy} onClick={() => go(() => appAuth.social(p))}>
            {PROVIDER_LABEL[p]}
          </button>
        ))}
        {session.mock && (
          <>
            <div className="alert warn">Mock mode: sign in as a local demo user. No provider is needed.</div>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                go(async () => {
                  await appAuth.demo();
                  await qc.invalidateQueries({ queryKey: ['session'] });
                })
              }
            >
              Continue as demo user
            </button>
          </>
        )}
        {!session.providers.length && !session.mock && (
          <div className="alert error">
            No sign-in provider is configured. Set GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.
          </div>
        )}
      </div>
    </div>
  );
}

export function NotAllowed({ session }: { session: SessionInfo }) {
  const signOut = useSignOut();
  return (
    <div className="connect">
      <div className="card">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Data 360 Workbench
        </div>
        {session.user?.blocked ? (
          <div className="alert error" role="alert">
            Your access to this workbench (<b>{session.user.email}</b>) has been suspended by an administrator.
          </div>
        ) : (
          <div className="alert error" role="alert">
            You're signed in as <b>{session.user?.email}</b>, which isn't allowed to use this workbench. Ask its
            administrator to add your email or domain, or sign in with another account. Only provider-verified emails count.
          </div>
        )}
        <button onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
