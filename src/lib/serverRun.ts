/**
 * Runs a server-frozen protocol in the browser and records terminal outcomes on the
 * server as they arrive (append_attempts), then finalizes once (complete_analysis).
 * If the tab dies, the server keeps what was appended and the reload shows the run
 * as interrupted.
 */
import { appendAttempts, completeOnServer } from './api/persist';
import { assess } from './assess';
import { getSession, putSession } from './session';
import { launch } from './runs';

const syncErrors = new Map<string, string>();

export function syncErrorFor(recordId: string): string | null {
  return syncErrors.get(recordId) ?? null;
}

export function runServerFrozen(recordId: string): boolean {
  const record = getSession(recordId);
  if (!record || record.persistence.kind !== 'saved' || record.persistence.origin !== 'server_frozen' || !record.serverExecutionId) {
    return false;
  }
  const executionId = record.serverExecutionId;
  const protocol = record.protocol;
  let chain: Promise<unknown> = Promise.resolve();
  const note = (error: string) => {
    syncErrors.set(recordId, error);
    const current = getSession(recordId);
    if (current) putSession({ ...current });
  };
  const started = launch(recordId, { kind: 'full' }, {
    executionId,
    onAttempt: (attempt) => {
      chain = chain.then(async () => {
        const result = await appendAttempts(executionId, protocol, [attempt]);
        if (!result.ok) note(`Server append failed: ${result.error}`);
      });
    },
  });
  if (!started) return false;
  void started.done.then(async (execution) => {
    await chain;
    // Idempotent: re-sends every terminal record, including cancelled/interrupted ones.
    const appended = await appendAttempts(executionId, protocol, execution.attempts);
    if (!appended.ok) {
      note(`Server append failed: ${appended.error}`);
      return;
    }
    const latest = getSession(recordId);
    if (!latest) return;
    const assessment = assess({ ...latest, storedDerived: null });
    const derived =
      assessment.headline && assessment.factsHash ? { headlineCode: assessment.headline.code, factsHash: assessment.factsHash } : null;
    const completed = await completeOnServer(recordId, execution, derived);
    if (!completed.ok) {
      note(`Server finalization failed: ${completed.error}`);
      return;
    }
    syncErrors.delete(recordId);
    const after = getSession(recordId);
    if (after) putSession({ ...after, storedDerived: derived, savedExecutionIds: [...new Set([...after.savedExecutionIds, executionId])] });
  });
  return true;
}
