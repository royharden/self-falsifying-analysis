import { useEffect, useState } from 'react';
import { LogView } from '../components/LogView';
import { loadRemote, saveAnalysis, setShared } from '../lib/api/persist';
import { useAuth } from '../lib/auth';
import type { AnalysisRecord } from '../lib/record';
import { getSession, putSession } from '../lib/session';
import { supabaseReady } from '../lib/supabase';

export function AnalysisPage({ id }: { id: string }) {
  const auth = useAuth();
  const [record, setRecord] = useState<AnalysisRecord | null>(() => getSession(id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function onSave() {
    if (!record) return;
    setBusy(true);
    setError(null);
    const result = await saveAnalysis(record);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    putSession(result.record);
    window.location.hash = `#/analyses/${result.record.id}`;
  }

  async function onShare(next: boolean) {
    if (!record?.saved) return;
    setBusy(true);
    setError(null);
    const result = await setShared(record.id, next);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const updated = { ...record, isShared: next };
    putSession(updated);
    setRecord(updated);
  }

  if (!record) {
    return (
      <section>
        <h1>Run</h1>
        {error ? <p className="error" role="alert">{error}</p> : <p>Loading…</p>}
      </section>
    );
  }

  const shareUrl = record.shareToken
    ? `${window.location.origin}${window.location.pathname}#/share/${encodeURIComponent(record.shareToken)}`
    : '';

  return (
    <section>
      <LogView record={record} attemptHref={(ordinal) => `#/analyses/${encodeURIComponent(record.id)}/attempts/${ordinal}`} />
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!record.saved && supabaseReady ? (
        <p>
          <button type="button" disabled={busy || !auth.email} onClick={() => void onSave()}>
            {auth.email ? 'Save this run' : 'Sign in to save'}
          </button>
        </p>
      ) : null}
      {!supabaseReady ? <p className="muted">This run stays in the browser tab until Supabase is configured.</p> : null}
      {record.saved && record.shareToken ? (
        <div className="stack">
          <label>
            <input type="checkbox" checked={record.isShared} disabled={busy} onChange={(event) => void onShare(event.target.checked)} />
            Share a read-only link. This publishes the table, the claim, and the attempt log.
          </label>
          {record.isShared ? <p><a href={shareUrl}>{shareUrl}</a></p> : null}
        </div>
      ) : null}
    </section>
  );
}
