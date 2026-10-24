import { useEffect, useState } from 'react';
import { listRemote, type RemoteSummary } from '../lib/api/persist';
import { useAuth } from '../lib/auth';
import { formatKind } from '../lib/format';
import { listSession, subscribeSession } from '../lib/session';

export function HomePage() {
  const auth = useAuth();
  const [localTick, setLocalTick] = useState(0);
  const [remote, setRemote] = useState<RemoteSummary[]>([]);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  useEffect(() => subscribeSession(() => setLocalTick((value) => value + 1)), []);

  useEffect(() => {
    if (!auth.email) {
      setRemote([]);
      return undefined;
    }
    let active = true;
    void listRemote().then((result) => {
      if (!active) return;
      if (!result.ok) setRemoteError(result.error);
      else {
        setRemoteError(null);
        setRemote(result.rows);
      }
    });
    return () => {
      active = false;
    };
  }, [auth.email]);

  const local = listSession().filter((record) => !record.saved);
  void localTick;

  return (
    <section>
      <h1>Try to break the claim, then rerun the attempt.</h1>
      <p>
        State an association. A frozen menu of attacks looks for a placebo, a confounder, a fragile subset,
        and a rank specification. Every attempt keeps the program that produced it. Open one and run it again.
      </p>
      <div className="actions">
        <a className="button" href="#/new">Run the workshop demo</a>
        <a className="button secondary" href="#/bench">Planted-effect bench</a>
      </div>
      <h2>In this browser</h2>
      {local.length === 0 ? <p className="muted">No unsaved run yet.</p> : (
        <ul className="index">
          {local.map((record) => (
            <li key={record.id}>
              <a href={`#/analyses/${encodeURIComponent(record.id)}`}>{record.claim.statement}</a>
              <span>{formatKind(record.run.verdict)}</span>
            </li>
          ))}
        </ul>
      )}
      <h2>Saved runs</h2>
      {!auth.configured ? <p className="muted">Saving needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p> : null}
      {auth.configured && !auth.email ? <p className="muted"><a href="#/login">Sign in</a> to load saved runs.</p> : null}
      {remoteError ? <p className="error" role="alert">{remoteError}</p> : null}
      {auth.email && remote.length === 0 && !remoteError ? <p className="muted">No saved runs.</p> : null}
      {remote.length > 0 ? (
        <ul className="index">
          {remote.map((row) => (
            <li key={row.id}>
              <a href={`#/analyses/${row.id}`}>{row.statement}</a>
              <span>{formatKind(row.verdict)}{row.isShared ? ' · shared' : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
