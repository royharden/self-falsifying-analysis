import { useState } from 'react';
import { deleteRemote, idempotencyKeyFor, saveLocal, saveRerun, setShare } from '../lib/api/persist';
import type { Assessment } from '../lib/assess';
import { useAuth } from '../lib/auth';
import type { AnalysisRecord } from '../lib/record';
import { putSession, removeSession } from '../lib/session';

/**
 * Save, share, revoke and delete. Every transfer of rows is explained and needs an
 * explicit checkbox; nothing is uploaded automatically.
 */
export function PersistPanel({ record, assessment }: { record: AnalysisRecord; assessment: Assessment }) {
  const auth = useAuth();
  const [consentUpload, setConsentUpload] = useState(false);
  const [consentShare, setConsentShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  if (record.persistence.kind === 'shared_view') {
    return <p className="muted">Shared read-only snapshot. Reruns happen in your browser and are not written anywhere.</p>;
  }
  if (!auth.configured) {
    return <p className="muted">This analysis lives only in this browser tab. Export run.json to keep it; a reload loses it.</p>;
  }
  if (!auth.email) {
    return <p className="muted">This analysis lives only in this tab. <a href="#/login">Sign in</a> to save it privately to your account.</p>;
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const original = record.executions.find((execution) => execution.executionId === record.originalExecutionId);
  const finished = original !== undefined && original.status !== 'running';

  if (record.persistence.kind === 'local') {
    const canSave = finished && assessment.headline !== null && assessment.factsHash !== null && assessment.integrityErrors.length === 0;
    return (
      <section className="stack">
        <h2>Save privately</h2>
        <p className="muted">
          Saving uploads the full table, the frozen protocol and every terminal record to your account (owner-only). Because this run was executed before
          any server receipt, it is stored as <strong>uploaded after execution</strong>; the server cannot vouch that the protocol was frozen first.
        </p>
        <label>
          <input type="checkbox" checked={consentUpload} onChange={(event) => setConsentUpload(event.target.checked)} />
          Upload these {record.table.rows.length} rows privately to my account.
        </label>
        <button
          type="button"
          disabled={!canSave || !consentUpload || busy}
          onClick={() =>
            void run(async () => {
              if (!assessment.headline || !assessment.factsHash) return;
              const saved = await saveLocal(record, { headlineCode: assessment.headline.code, factsHash: assessment.factsHash }, idempotencyKeyFor(record.id, 'save_local'));
              if (!saved.ok) {
                setError(saved.error);
                return;
              }
              removeSession(record.id);
              putSession(saved.value);
              window.location.hash = `#/analyses/${encodeURIComponent(saved.value.id)}`;
            })
          }
        >
          Save to my account
        </button>
        {!canSave ? <p className="muted">Saving needs a finished run that passes the integrity check.</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>
    );
  }

  const unsavedReruns = record.executions.filter(
    (execution) => execution.executionId !== record.originalExecutionId && execution.status !== 'running' && !record.savedExecutionIds.includes(execution.executionId),
  );
  const shareUrl = token ? `${window.location.origin}${window.location.pathname}#/share/${encodeURIComponent(token)}` : null;

  return (
    <section className="stack">
      <h2>Saved privately</h2>
      <p className="muted">
        {record.persistence.origin === 'server_frozen'
          ? 'The server received this protocol before the browser ran it (receipt time shown below). This orders persistence only; it does not prove prior blindness or honest client computation.'
          : 'Uploaded after execution in this browser.'}{' '}
        {record.persistence.serverReceivedAt ? `Server receipt: ${record.persistence.serverReceivedAt}.` : null}
      </p>

      {unsavedReruns.length > 0 ? (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const saved: string[] = [];
              for (const execution of unsavedReruns) {
                const result = await saveRerun(record, execution);
                if (!result.ok) {
                  setError(result.error);
                  break;
                }
                saved.push(execution.executionId);
              }
              putSession({ ...record, savedExecutionIds: [...record.savedExecutionIds, ...saved] });
            })
          }
        >
          Save {unsavedReruns.length} finished rerun(s)
        </button>
      ) : null}

      <h3>Share</h3>
      {record.share?.enabled ? (
        <>
          <p>An unlisted link is active. Anyone with it can read and download every row; revoking stops future fetches but cannot recall copies.</p>
          {shareUrl ? <p>Copy this link now; it is shown only once: <a href={shareUrl}>{shareUrl}</a></p> : null}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await setShare(record.id, false, false);
                if (!result.ok) setError(result.error);
                else {
                  setToken(null);
                  putSession({ ...record, share: { enabled: false, token: null } });
                }
              })
            }
          >
            Revoke the link
          </button>
        </>
      ) : record.share && !record.share.enabled ? (
        <p className="muted">The share link was revoked. Creating a new link for the same analysis (token rotation) is not supported in this version.</p>
      ) : (
        <>
          <label>
            <input type="checkbox" checked={consentShare} onChange={(event) => setConsentShare(event.target.checked)} />
            Publish an immutable snapshot with all {record.table.rows.length} rows, the claim and the original run to anyone holding the link.
          </label>
          <button
            type="button"
            disabled={!consentShare || busy || !finished}
            onClick={() =>
              void run(async () => {
                const result = await setShare(record.id, true, true);
                if (!result.ok) setError(result.error);
                else {
                  setToken(result.value.token);
                  putSession({ ...record, share: { enabled: true, token: null } });
                }
              })
            }
          >
            Create share link
          </button>
          <p className="muted">Later local reruns are not part of the snapshot.</p>
        </>
      )}

      <h3>Delete</h3>
      {confirmDelete ? (
        <div className="actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await deleteRemote(record.id);
                if (!result.ok) setError(result.error);
                else {
                  removeSession(record.id);
                  window.location.hash = '#/';
                }
              })
            }
          >
            Permanently delete this analysis and its evidence
          </button>
          <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>Keep it</button>
        </div>
      ) : (
        <button type="button" className="secondary" onClick={() => setConfirmDelete(true)}>Delete…</button>
      )}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
