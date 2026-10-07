import { useQueryClient } from '@tanstack/react-query';
import { api, appAuth, type SessionInfo } from '../api';

/** Signs out of Salesforce (revoking the token) and then the app, and drops everything cached. */
export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await api.logout().catch(() => undefined);
    await appAuth.signOut().catch(() => undefined);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    qc.setQueryData<SessionInfo>(['session'], (s) => (s ? { ...s, user: null, connected: false, instanceHost: null } : s));
  };
}

export function UserMenu({ session }: { session: SessionInfo }) {
  const signOut = useSignOut();
  if (!session.user) return null;
  return (
    <div className="row small" style={{ gap: 8 }}>
      <span className="muted" title="Signed in to the workbench">{session.user.email}</span>
      <button type="button" onClick={signOut}>Sign out</button>
    </div>
  );
}
