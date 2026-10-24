/**
 * Main-thread controller for one execution (PLAN.md 4.4). One recipe per worker
 * request with a frozen per-attempt deadline; a stuck worker is terminated and
 * recreated, user cancellation terminates it and terminalizes unresolved slots.
 */
import { nonResult } from '../falsify/attacks';
import {
  expectedOrdinals,
  observe,
  terminalizeUnresolved,
  type ExecutionRecord,
} from '../falsify/bundle';
import { executionOrder, recipeHash } from '../falsify/planSchema';
import type { ProtocolV1, Table, TerminalAttempt } from '../falsify/types';
import { isWorkerResponse, type WorkerRequest, type WorkerResponse } from './protocol';

export type RunHandle = {
  cancel: () => void;
  done: Promise<ExecutionRecord>;
};

function createWorker(): Worker {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
}

/** Checks that a worker result is the slot we asked for, under the frozen recipe. */
function acceptResult(protocol: ProtocolV1, ordinal: number, attempt: TerminalAttempt): string | null {
  const recipe = protocol.recipes[ordinal];
  if (attempt.ordinal !== ordinal || attempt.kind !== recipe.kind) return 'The worker returned a different recipe slot.';
  if (attempt.recipeHash !== recipeHash(recipe)) return 'The worker result is bound to a different recipe.';
  return null;
}

export function startExecution(options: {
  table: Table;
  protocol: ProtocolV1;
  protocolHash: string;
  execution: ExecutionRecord;
  onUpdate: (execution: ExecutionRecord) => void;
}): RunHandle {
  const { table, protocol, protocolHash, execution, onUpdate } = options;
  const wanted = new Set(expectedOrdinals(execution.scope));
  const queue = executionOrder(protocol).filter((ordinal) => wanted.has(ordinal));
  let worker: Worker | null = null;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: { requestId: string; ordinal: number } | null = null;
  let workersStarted = 0;
  let resolveDone: (execution: ExecutionRecord) => void = () => undefined;
  const done = new Promise<ExecutionRecord>((resolve) => {
    resolveDone = resolve;
  });

  const emit = () => onUpdate({ ...execution, attempts: [...execution.attempts], events: [...execution.events] });

  const stopWorker = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    worker?.terminate();
    worker = null;
  };

  const finish = (status: ExecutionRecord['status']) => {
    if (finished) return;
    finished = true;
    stopWorker();
    if (status === 'cancelled') {
      observe(execution, 'execution_cancelled');
      terminalizeUnresolved(execution, protocol, 'cancelled');
    } else if (status === 'interrupted') {
      observe(execution, 'execution_interrupted');
      terminalizeUnresolved(execution, protocol, 'interrupted');
    } else {
      observe(execution, 'execution_finished');
    }
    execution.status = status;
    execution.endedAt = new Date().toISOString();
    execution.attempts.sort((left, right) => left.ordinal - right.ordinal);
    emit();
    resolveDone(execution);
  };

  const record = (attempt: TerminalAttempt) => {
    execution.attempts.push(attempt);
    observe(execution, 'attempt_finished', attempt.ordinal);
    emit();
  };

  const next = () => {
    if (finished) return;
    const ordinal = queue.shift();
    if (ordinal === undefined) {
      finish('completed');
      return;
    }
    const requestId = crypto.randomUUID();
    current = { requestId, ordinal };
    timer = setTimeout(() => {
      if (finished || current?.requestId !== requestId) return;
      // The deadline stops this slot only. A fresh worker takes the remaining slots.
      stopWorker();
      observe(execution, 'attempt_timed_out', ordinal);
      record(nonResult(protocol.recipes[ordinal], 'error', 'timeout', `No result within the frozen ${protocol.attemptDeadlineMs} ms deadline; the worker was stopped.`));
      current = null;
      ensureWorker().then(next, (reason: string) => failRemaining(reason));
    }, protocol.attemptDeadlineMs);
    const request: WorkerRequest = { type: 'run', requestId, ordinal };
    worker?.postMessage(request);
  };

  const failRemaining = (reason: string) => {
    for (const ordinal of [current?.ordinal, ...queue]) {
      if (ordinal === undefined) continue;
      record(nonResult(protocol.recipes[ordinal], 'error', 'contract_rejected', reason));
    }
    queue.length = 0;
    current = null;
    finish('completed');
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    if (finished) return;
    const message = event.data;
    if (!isWorkerResponse(message)) return;
    handle(message);
  };

  const handle = (message: WorkerResponse) => {
    if (message.type === 'loaded') return;
    if (!current || message.requestId !== current.requestId) return;
    if (message.type === 'started') {
      observe(execution, 'attempt_started', message.ordinal);
      emit();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = null;
    const ordinal = current.ordinal;
    current = null;
    if (message.type === 'result') {
      const problem = acceptResult(protocol, ordinal, message.attempt);
      record(problem ? nonResult(protocol.recipes[ordinal], 'error', 'result_rejected', problem) : message.attempt);
    } else {
      record(nonResult(protocol.recipes[ordinal], 'error', 'worker_failed', message.reason));
    }
    next();
  };

  const ensureWorker = (): Promise<void> =>
    new Promise((resolve, reject) => {
      workersStarted += 1;
      if (workersStarted > 6) {
        reject('The engine worker could not be started repeatedly; remaining recipes were not run.');
        return;
      }
      const fresh = createWorker();
      worker = fresh;
      const loadTimer = setTimeout(() => {
        fresh.removeEventListener('message', onLoaded);
        if (worker === fresh) stopWorker();
        reject(`The engine worker did not load within ${protocol.attemptDeadlineMs} ms.`);
      }, protocol.attemptDeadlineMs);
      const onLoaded = (event: MessageEvent<unknown>) => {
        const message = event.data;
        if (!isWorkerResponse(message) || message.type !== 'loaded') return;
        clearTimeout(loadTimer);
        fresh.removeEventListener('message', onLoaded);
        if (message.ok) {
          fresh.addEventListener('message', onMessage);
          resolve();
        } else {
          reject(`The worker rejected the frozen inputs: ${message.errors.slice(0, 3).join(' ')}`);
        }
      };
      fresh.addEventListener('message', onLoaded);
      fresh.addEventListener('error', () => {
        if (finished || worker !== fresh) return;
        // A crash ends the current slot as an error; a new worker continues with the rest.
        stopWorker();
        if (current) {
          const ordinal = current.ordinal;
          current = null;
          record(nonResult(protocol.recipes[ordinal], 'error', 'worker_crashed', 'The worker stopped unexpectedly during this recipe.'));
        }
        ensureWorker().then(next, (reason: string) => failRemaining(reason));
      });
      const load: WorkerRequest = { type: 'load', table, protocol, protocolHash };
      fresh.postMessage(load);
    });

  execution.status = 'running';
  execution.startedAt = new Date().toISOString();
  observe(execution, 'execution_started');
  emit();
  ensureWorker().then(next, (reason: string) => failRemaining(reason));

  return {
    cancel: () => finish('cancelled'),
    done,
  };
}

/** Marks an execution that was running when its page/tab state was lost. */
export function markInterrupted(execution: ExecutionRecord, protocol: ProtocolV1): ExecutionRecord {
  if (execution.status !== 'running') return execution;
  const copy: ExecutionRecord = { ...execution, attempts: [...execution.attempts], events: [...execution.events] };
  observe(copy, 'execution_interrupted');
  terminalizeUnresolved(copy, protocol, 'interrupted');
  copy.status = 'interrupted';
  copy.endedAt = new Date().toISOString();
  return copy;
}
