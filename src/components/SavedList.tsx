import { useEffect, useState } from 'react';
import { listRemote, type RemoteSummary } from '../lib/api/persist';
import { useAuth } from '../lib/auth';

/** Owner's saved analyses. Derived headlines listed here are stored labels; opening a record recomputes them. */
export function SavedList() {
  const auth = useAuth();
  const [rows, setRows] = useState<RemoteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.email) {
      setRows([]);
      return undefined;
    }
    let active = true;
    void listRemote().then((result) => {
      if (!active) return;
      if (result.ok) {
        setRows(result.value);
        setError(null);
      } else setError(result.error);
    });
    return () => {
      active = false;
    };
  }, [auth.email]);

  return (
    <>
      <h2>Saved analyses</h2>
      {!auth.configured ? <p className="muted">Saving needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (live mode).</p> : null}
      {auth.configured && !auth.email ? <p className="muted"><a href="#/login">Sign in</a> to see saved analyses.</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {auth.email && rows.length === 0 && !error ? <p className="muted">No saved analyses yet.</p> : null}
      {rows.length > 0 ? (
        <ul className="index">
          {rows.map((row) => (
            <li key={row.id}>
              <a href={`#/analyses/${encodeURIComponent(row.id)}`}>“{row.statement}”</a>
              <span>
                {row.lifecycle === 'complete' ? `stored label: ${row.derivedHeadline ?? 'none'}` : 'not finished'} · {row.origin.replaceAll('_', ' ')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
