import { useEffect, useState } from 'react';
import { loadRemote } from './api/persist';
import { useAuth } from './auth';
import { putSession } from './session';

/**
 * Loads a saved analysis into the session when it is not already in this tab.
 * The loaded record is revalidated by assess() like any other; nothing stored is trusted.
 */
export function useRemoteRecord(id: string, enabled: boolean): { loading: boolean; error: string | null } {
  const auth = useAuth();
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    if (!auth.configured) {
      setState({ loading: false, error: 'This analysis is not in this browser tab. Unsaved local work is lost on reload; export run.json to keep it.' });
      return undefined;
    }
    if (!auth.ready) {
      setState({ loading: true, error: null });
      return undefined;
    }
    if (!auth.email) {
      setState({ loading: false, error: 'This analysis is not in this tab. Sign in to open your saved analyses.' });
      return undefined;
    }
    let active = true;
    setState({ loading: true, error: null });
    void loadRemote(id).then((result) => {
      if (!active) return;
      if (result.ok) {
        putSession(result.value);
        setState({ loading: false, error: null });
      } else {
        setState({ loading: false, error: result.error });
      }
    });
    return () => {
      active = false;
    };
  }, [id, enabled, auth.configured, auth.ready, auth.email]);
  return state;
}
