import { useAuth } from '../lib/auth';

/** Owner's saved analyses. Needs the configured backend and a signed-in account. */
export function SavedList() {
  const auth = useAuth();
  return (
    <>
      <h2>Saved analyses</h2>
      {!auth.configured ? <p className="muted">Saving needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (live mode).</p> : null}
      {auth.configured && !auth.email ? <p className="muted"><a href="#/login">Sign in</a> to see saved analyses.</p> : null}
    </>
  );
}
