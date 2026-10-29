import { useEffect, useState } from 'react';
import { AttemptPage } from './AttemptPage';
import { LogView } from '../components/LogView';
import { loadShared } from '../lib/api/persist';
import { assess } from '../lib/assess';
import type { AnalysisRecord } from '../lib/record';
import { getSession, putSession } from '../lib/session';
import { supabaseReady } from '../lib/supabase';
import { useSessionRecord } from '../lib/useRecord';

/**
 * Signed-out reader of an immutable shared snapshot. The snapshot is revalidated
 * here; reruns stay in this browser and are never written back.
 */
export function SharePage({ token, ordinal }: { token: string; ordinal?: number }) {
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const record = useSessionRecord(id ?? '');

  useEffect(() => {
    if (!supabaseReady) {
      setError('Shared links need the configured backend (live mode).');
      return undefined;
    }
    let active = true;
    void loadShared(token).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // An owner viewing their own link in the same tab keeps their saved copy.
      if (!getSession(result.value.id)) putSession(result.value);
      setId(result.value.id);
    });
    return () => {
      active = false;
    };
  }, [token]);

  if (!record) {
    return (
      <section>
        <h1>Shared analysis</h1>
        {error ? <p className="error" role="alert">{error}</p> : <p>Loading…</p>}
      </section>
    );
  }
  const back = `#/share/${encodeURIComponent(token)}`;
  if (ordinal !== undefined) return <AttemptPage record={record} ordinal={ordinal} backHref={back} />;
  return <SharedView record={record} back={back} />;
}

function SharedView({ record, back }: { record: AnalysisRecord; back: string }) {
  const assessment = assess(record);
  return (
    <section>
      <p className="note">
        Read-only shared snapshot{record.persistence.kind === 'shared_view' ? '' : ' (your saved copy)'}. The headline below was regenerated from the
        evidence in this browser; open a check to inspect its recipe and kernel source, and rerun it locally.
      </p>
      <LogView record={record} assessment={assessment} attemptHref={(item) => `${back}/attempts/${item}`} />
    </section>
  );
}
