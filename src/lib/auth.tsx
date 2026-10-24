import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, supabaseReady } from './supabase';

type AuthState = {
  configured: boolean;
  ready: boolean;
  email: string | null;
};

const AuthContext = createContext<AuthState>({ configured: supabaseReady, ready: !supabaseReady, email: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    configured: supabaseReady,
    ready: !supabaseReady,
    email: null,
  });

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState({ configured: true, ready: true, email: data.session?.user.email ?? null });
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ configured: true, ready: true, email: session?.user.email ?? null });
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
