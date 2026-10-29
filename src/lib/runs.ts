/**
 * Live executions in this tab. Navigating inside the app keeps them running; a
 * reload loses them and the record shows them as interrupted.
 */
import { newExecution, type ExecutionRecord, type ExecutionScope } from './falsify/bundle';
import type { TerminalAttempt } from './falsify/types';
import { getSession, putSession } from './session';
import { markInterrupted, startExecution, type RunHandle } from './worker/client';

const live = new Map<string, RunHandle>();

function replaceExecution(recordId: string, execution: ExecutionRecord): void {
  const record = getSession(recordId);
  if (!record) return;
  const executions = record.executions.some((item) => item.executionId === execution.executionId)
    ? record.executions.map((item) => (item.executionId === execution.executionId ? execution : item))
    : [...record.executions, execution];
  putSession({ ...record, executions });
}

export type LaunchOptions = {
  /** Server-assigned id for a server-frozen original execution. */
  executionId?: string;
  /** Called once for every new terminal record, in arrival order. */
  onAttempt?: (attempt: TerminalAttempt) => void;
};

/**
 * Starts an execution of the record's frozen protocol. A full run with no original
 * becomes the original; every later run is linked to its parent.
 */
export function launch(
  recordId: string,
  scope: ExecutionScope,
  options: LaunchOptions = {},
): { executionId: string; done: Promise<ExecutionRecord> } | null {
  const record = getSession(recordId);
  if (!record) return null;
  const isOriginal = scope.kind === 'full' && record.originalExecutionId === null;
  const execution = newExecution(record.id, record.protocolHash, scope, isOriginal ? null : record.originalExecutionId, options.executionId);
  const reported = new Set<number>();
  putSession({
    ...record,
    originalExecutionId: isOriginal ? execution.executionId : record.originalExecutionId,
    executions: [...record.executions, execution],
  });
  const handle = startExecution({
    table: record.table,
    protocol: record.protocol,
    protocolHash: record.protocolHash,
    execution,
    onUpdate: (updated) => {
      replaceExecution(recordId, updated);
      for (const attempt of updated.attempts) {
        if (reported.has(attempt.ordinal)) continue;
        reported.add(attempt.ordinal);
        options.onAttempt?.(attempt);
      }
    },
  });
  live.set(execution.executionId, handle);
  void handle.done.finally(() => live.delete(execution.executionId));
  return { executionId: execution.executionId, done: handle.done };
}

export function cancel(executionId: string): void {
  live.get(executionId)?.cancel();
}

export function isLive(executionId: string): boolean {
  return live.has(executionId);
}

/** Running executions without a live handle in this tab are terminalized as interrupted. */
export function settleOrphans(recordId: string): void {
  const record = getSession(recordId);
  if (!record) return;
  let changed = false;
  const executions = record.executions.map((execution) => {
    if (execution.status !== 'running' || live.has(execution.executionId)) return execution;
    changed = true;
    return markInterrupted(execution, record.protocol);
  });
  if (changed) putSession({ ...record, executions });
}
