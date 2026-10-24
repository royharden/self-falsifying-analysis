import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearSavedRecords } from './session';
import { supabase, supabaseReady } from './supabase';

type AuthState = {
  configured: boolean;
  ready: boolean;
  email: string | null;
  userId: string | null;
  /** Paid planning requires a confirmed email address. */
  emailVerified: boolean;
};

const signedOut = { email: null, userId: null, emailVerified: false };

const AuthContext = createContext<AuthState>({ configured: supabaseReady, ready: !supabaseReady, ...signedOut });

type SessionLike = { user: { id: string; email?: string | null; email_confirmed_at?: string | null } } | null;

function fromSession(session: SessionLike): Omit<AuthState, 'configured' | 'ready'> {
  if (!session) return signedOut;
  return {
    email: session.user.email ?? null,
    userId: session.user.id,
    emailVerified: Boolean(session.user.email_confirmed_at),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ configured: supabaseReady, ready: !supabaseReady, ...signedOut });

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    void supabase.auth.getSession().then(({ data }: { data: { session: SessionLike } }) => {
      if (!active) return;
      setState({ configured: true, ready: true, ...fromSession(data.session) });
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event: string, session: SessionLike) => {
      setState({ configured: true, ready: true, ...fromSession(session) });
      // A recovery link signs the user in; send them to set a new password.
      if (event === 'PASSWORD_RECOVERY') window.location.hash = '#/reset';
      // Another account in this tab must not see the previous owner's saved records.
      if (event === 'SIGNED_OUT') clearSavedRecords();
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
