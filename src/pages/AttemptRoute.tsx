import { useEffect, useState } from 'react';
import { AttemptPage } from './AttemptPage';
import { loadRemote } from '../lib/api/persist';
import type { AnalysisRecord } from '../lib/record';
import { getSession, putSession } from '../lib/session';
import { supabaseReady } from '../lib/supabase';

export function AttemptRoute({ id, ordinal }: { id: string; ordinal: number }) {
  const [record, setRecord] = useState<AnalysisRecord | null>(() => getSession(id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const backHref = `#/analyses/${encodeURIComponent(id)}`;

  useEffect(() => {
    const cached = getSession(id);
    if (cached) {
      setRecord(cached);
      return undefined;
    }
    if (!supabaseReady || id.startsWith('local-')) {
      setError('This run is not in the browser session.');
      return undefined;
    }
    let active = true;
    void loadRemote(id).then((result) => {
      if (!active) return;
      if (!result.ok) setError(result.error);
      else {
        putSession(result.record);
        setRecord(result.record);
      }
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (!record) {
    return (
      <section>
        <p><a href={backHref}>Back to the log</a></p>
        {error ? <p className="error" role="alert">{error}</p> : <p>Loading…</p>}
      </section>
    );
  }
  return <AttemptPage record={record} ordinal={ordinal} backHref={backHref} />;
}
