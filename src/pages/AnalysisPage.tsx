import { useEffect, useMemo } from 'react';
import { LogView } from '../components/LogView';
import { PersistPanel } from '../components/PersistPanel';
import { assess } from '../lib/assess';
import { engineSourceDigest } from '../lib/engineSource';
import { eventsJsonl } from '../lib/falsify/bundle';
import { diffAttempts } from '../lib/falsify/grounding';
import { shortHash } from '../lib/format';
import { originalExecution, toBundle } from '../lib/record';
import { cancel, isLive, launch, settleOrphans } from '../lib/runs';
import { setRevision } from '../lib/session';
import { runServerFrozen, syncErrorFor } from '../lib/serverRun';
import { download, useSessionRecord } from '../lib/useRecord';
import { useRemoteRecord } from '../lib/useRemoteRecord';

export function AnalysisPage({ id }: { id: string }) {
  const record = useSessionRecord(id);
  const remote = useRemoteRecord(id, record === undefined);

  useEffect(() => settleOrphans(id), [id]);

  const assessment = useMemo(() => (record ? assess(record) : null), [record]);

  if (!record || !assessment) {
    return (
      <section>
        <h1>Analysis</h1>
        {remote.error ? <p className="error" role="alert">{remote.error}</p> : <p>{remote.loading ? 'Loading…' : 'This analysis is not in this browser tab.'}</p>}
      </section>
    );
  }

  const original = originalExecution(record);
  const running = record.executions.find((execution) => execution.status === 'running' && isLive(execution.executionId));
  const reruns = record.executions.filter((execution) => execution.executionId !== record.originalExecutionId);
  const readOnly = record.persistence.kind === 'shared_view';
  const canReplay =
    record.protocol.engineSourceDigest === engineSourceDigest && assessment.integrityErrors.length === 0 && original !== null && original.status !== 'running';

  const exportBundle = () => {
    const derived = assessment.headline && assessment.factsHash ? { headlineCode: assessment.headline.code, factsHash: assessment.factsHash } : null;
    download(`analysis-${record.id}.run.json`, `${JSON.stringify(toBundle(record, derived), null, 2)}\n`, 'application/json');
  };

  return (
    <section>
      <LogView record={record} assessment={assessment} attemptHref={(ordinal) => `#/analyses/${encodeURIComponent(record.id)}/attempts/${ordinal}`} />

      <div className="actions">
        {!original && !readOnly ? <button type="button" onClick={() => runServerFrozen(record.id) || launch(record.id, { kind: 'full' })}>Run the frozen protocol</button> : null}
        {running ? <button type="button" className="secondary" onClick={() => cancel(running.executionId)}>Cancel</button> : null}
        {canReplay && !running ? (
          <button type="button" className="secondary" onClick={() => launch(record.id, { kind: 'full' })}>Rerun all five recipes</button>
        ) : null}
        {original && original.status !== 'running' ? (
          <>
            <button type="button" className="secondary" onClick={exportBundle}>Export run.json</button>
            <button type="button" className="secondary" onClick={() => download(`analysis-${record.id}.events.jsonl`, eventsJsonl(toBundle(record, null)), 'application/x-ndjson')}>
              Export events.jsonl
            </button>
          </>
        ) : null}
        {!readOnly && original && original.status !== 'running' ? (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setRevision(record);
              window.location.hash = '#/new';
            }}
          >
            Revise as a new linked analysis
          </button>
        ) : null}
      </div>
      {syncErrorFor(record.id) ? <p className="error" role="alert">{syncErrorFor(record.id)} Local results are kept; export run.json if needed.</p> : null}
      {record.protocol.parentAnalysisId ? <p className="muted">Revision of analysis <code>{shortHash(record.protocol.parentAnalysisId)}</code>; the parent is unchanged.</p> : null}

      {reruns.length > 0 && original ? (
        <section>
          <h2>Reruns of the frozen protocol</h2>
          <p className="muted">
            Scientific numbers match when |a − b| ≤ 1e-12 + 1e-9·max(|a|, |b|); counts, n, df, masks, hashes and outcomes must match exactly.
            Reruns never issue a new headline.
          </p>
          <ul>
            {reruns.map((execution) => {
              const compared = execution.attempts.map((attempt) => {
                const stored = original.attempts.find((item) => item.ordinal === attempt.ordinal);
                return { ordinal: attempt.ordinal, diffs: stored ? diffAttempts(stored, attempt) : null };
              });
              const differing = compared.filter((item) => item.diffs === null || item.diffs.length > 0);
              return (
                <li key={execution.executionId}>
                  {execution.scope.kind === 'full' ? 'Full rerun' : `Recipe ${execution.scope.ordinal + 1} rerun`} — {execution.status};{' '}
                  {execution.status === 'running'
                    ? 'in progress'
                    : differing.length === 0
                      ? `all ${compared.length} compared record(s) match`
                      : `${differing.length} record(s) differ: ${differing.map((item) => `#${item.ordinal + 1}${item.diffs ? ` (${item.diffs.map((d) => d.path).slice(0, 4).join(', ')})` : ' (no stored record)'}`).join('; ')}`}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <PersistPanel record={record} assessment={assessment} />
    </section>
  );
}
