import { useEffect, useState } from 'react';
import { AttemptPage } from './AttemptPage';
import { LogView } from '../components/LogView';
import { loadShared } from '../lib/api/persist';
import type { AnalysisRecord } from '../lib/record';

export function SharePage({ token, ordinal }: { token: string; ordinal?: number }) {
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadShared(token).then((result) => {
      if (!active) return;
      if (!result.ok) setError(result.error);
      else setRecord(result.record);
    });
    return () => {
      active = false;
    };
  }, [token]);

  if (!record) {
    return (
      <section>
        <h1>Shared run</h1>
        {error ? <p className="error" role="alert">{error}</p> : <p>Loading…</p>}
      </section>
    );
  }

  const back = `#/share/${encodeURIComponent(token)}`;
  if (ordinal !== undefined) {
    return <AttemptPage record={record} ordinal={ordinal} backHref={back} />;
  }
  return (
    <section>
      <LogView record={record} attemptHref={(item) => `${back}/attempts/${item}`} />
      <p className="muted">Read only. Rerun uses the stored rows and the stored program.</p>
    </section>
  );
}
