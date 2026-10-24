import { supabaseReady } from '../lib/supabase';

/** Signed-out reader view of a shared snapshot. Loading lands with the persistence package. */
export function SharePage(_props: { token: string; ordinal?: number }) {
  return (
    <section>
      <h1>Shared analysis</h1>
      <p className="muted">
        {supabaseReady ? 'Shared links are not available in this build yet.' : 'Shared links need the configured backend (live mode).'}
      </p>
    </section>
  );
}
