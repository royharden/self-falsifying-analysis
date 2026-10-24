import { runRecipe } from './attacks';
import { executionOrder } from './planSchema';
import type { ProtocolV1, Table, TerminalAttempt } from './types';

/**
 * Runs every recipe of a frozen protocol in execution order (baseline, primary,
 * then the frozen secondary order). Returns terminal records sorted by ordinal.
 */
export function runFull(
  table: Table,
  protocol: ProtocolV1,
  onAttempt?: (attempt: TerminalAttempt) => void,
): TerminalAttempt[] {
  const attempts: TerminalAttempt[] = [];
  for (const ordinal of executionOrder(protocol)) {
    const attempt = runRecipe(table, protocol, ordinal);
    attempts.push(attempt);
    onAttempt?.(attempt);
  }
  return attempts.sort((left, right) => left.ordinal - right.ordinal);
}

/** Reruns exactly one frozen recipe on the exact rows. */
export function runOne(table: Table, protocol: ProtocolV1, ordinal: number): TerminalAttempt {
  return runRecipe(table, protocol, ordinal);
}
