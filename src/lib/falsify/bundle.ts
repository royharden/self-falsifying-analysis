/**
 * Execution records and the exported bundle (PLAN.md 4.2). Events are derived from
 * transitions this browser actually observed; there is no independent event store.
 */
import { nonResult } from './attacks';
import type { ProtocolV1, Table, TerminalAttempt } from './types';
import { RECIPE_KINDS } from './types';

export const BUNDLE_SCHEMA = 1;

export type ReceiptLabel = 'locally_observed' | 'server_receipt';

export type ExecutionScope = { kind: 'full' } | { kind: 'rerun_one'; ordinal: number };

export type ExecutionStatus = 'running' | 'completed' | 'cancelled' | 'interrupted';

export type ObservedEventType =
  | 'execution_started'
  | 'attempt_started'
  | 'attempt_finished'
  | 'attempt_timed_out'
  | 'execution_cancelled'
  | 'execution_interrupted'
  | 'execution_finished';

export type ObservedEvent = {
  seq: number;
  at: string;
  type: ObservedEventType;
  ordinal: number | null;
  label: ReceiptLabel;
};

export type ExecutionRecord = {
  executionId: string;
  analysisId: string;
  parentExecutionId: string | null;
  scope: ExecutionScope;
  protocolHash: string;
  origin: 'local' | 'server_frozen' | 'uploaded_after_execution';
  startedAt: string | null;
  endedAt: string | null;
  status: ExecutionStatus;
  attempts: TerminalAttempt[];
  events: ObservedEvent[];
};

export type BundleV1 = {
  bundleSchema: 1;
  analysisId: string;
  parentAnalysisId: string | null;
  datasetName: string;
  createdAt: string;
  table: Table;
  protocol: ProtocolV1;
  protocolHash: string;
  originalExecutionId: string | null;
  executions: ExecutionRecord[];
  /** Derived at export time; recomputed and compared on load, never trusted. */
  derived: { headlineCode: string; factsHash: string } | null;
};

export function expectedOrdinals(scope: ExecutionScope): number[] {
  return scope.kind === 'full' ? RECIPE_KINDS.map((_, ordinal) => ordinal) : [scope.ordinal];
}

export function newExecution(
  analysisId: string,
  protocolHash: string,
  scope: ExecutionScope,
  parentExecutionId: string | null,
): ExecutionRecord {
  return {
    executionId: crypto.randomUUID(),
    analysisId,
    parentExecutionId,
    scope,
    protocolHash,
    origin: 'local',
    startedAt: null,
    endedAt: null,
    status: 'running',
    attempts: [],
    events: [],
  };
}

export function observe(execution: ExecutionRecord, type: ObservedEventType, ordinal: number | null = null): ObservedEvent {
  const event: ObservedEvent = {
    seq: execution.events.length,
    at: new Date().toISOString(),
    type,
    ordinal,
    label: 'locally_observed',
  };
  execution.events.push(event);
  return event;
}

/**
 * Terminalizes every expected slot that has no record: a started slot becomes
 * cancelled/interrupted, an unstarted one says it never started. Never fabricates
 * start times or results.
 */
export function terminalizeUnresolved(
  execution: ExecutionRecord,
  protocol: ProtocolV1,
  outcome: 'cancelled' | 'interrupted',
): void {
  const done = new Set(execution.attempts.map((attempt) => attempt.ordinal));
  const started = new Set(
    execution.events.filter((event) => event.type === 'attempt_started').map((event) => event.ordinal),
  );
  for (const ordinal of expectedOrdinals(execution.scope)) {
    if (done.has(ordinal)) continue;
    const recipe = protocol.recipes[ordinal];
    const wasStarted = started.has(ordinal);
    const reasonCode = wasStarted ? `${outcome}_while_running` : `not_started_${outcome}`;
    const reason = wasStarted
      ? `The run was ${outcome} while this recipe was running; no result was recorded.`
      : `The run was ${outcome} before this recipe started.`;
    execution.attempts.push(nonResult(recipe, outcome, reasonCode, reason));
  }
  execution.attempts.sort((left, right) => left.ordinal - right.ordinal);
}

/** events.jsonl: one observed transition per line, in recorded order. */
export function eventsJsonl(bundle: BundleV1): string {
  const lines: string[] = [];
  for (const execution of bundle.executions) {
    for (const event of execution.events) {
      lines.push(JSON.stringify({ executionId: execution.executionId, scope: execution.scope, ...event }));
    }
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
