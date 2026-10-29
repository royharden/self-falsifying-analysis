import type { ProtocolV1, Table, TerminalAttempt } from '../falsify/types';

/** Main thread -> worker. */
export type WorkerRequest =
  | { type: 'load'; table: Table; protocol: ProtocolV1; protocolHash: string }
  | { type: 'run'; requestId: string; ordinal: number };

/** Worker -> main thread. */
export type WorkerResponse =
  | { type: 'loaded'; ok: true }
  | { type: 'loaded'; ok: false; errors: string[] }
  | { type: 'started'; requestId: string; ordinal: number }
  | { type: 'result'; requestId: string; attempt: TerminalAttempt }
  | { type: 'failed'; requestId: string; ordinal: number; reason: string };

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'loaded' || type === 'started' || type === 'result' || type === 'failed';
}
