import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null when the public configuration is absent: the app then runs in local guided mode. */
function createSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    // PKCE returns ?code= in the query string, which coexists with the hash router.
    return createClient(supabaseUrl, supabaseAnonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
  } catch {
    return null;
  }
}

export const supabase = createSupabaseClient();

export const supabaseReady = supabase !== null;

/** Where auth emails send the user back to. Must be in the project's redirect allowlist. */
export function authRedirect(route: string): string {
  return `${window.location.origin}${window.location.pathname}${route}`;
}
