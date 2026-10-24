import { describe, expect, it } from 'vitest';
import { headlineFor } from '../src/lib/falsify/aggregate';
import { newExecution, observe, terminalizeUnresolved, type ExecutionRecord } from '../src/lib/falsify/bundle';
import { workshopFixture } from '../src/lib/falsify/generate';
import { diffAttempts, factsFor, FactBook, validateAttempt, validateExecution } from '../src/lib/falsify/grounding';
import { buildProtocol, DEFAULT_SECONDARY_ORDER } from '../src/lib/falsify/planSchema';
import { runFull } from '../src/lib/falsify/runner';
import type { TerminalAttempt } from '../src/lib/falsify/types';

const fixture = workshopFixture('confounded');
const built = buildProtocol({
  table: fixture.table,
  dataset: fixture.dataset,
  claim: {
    statement: fixture.suggestion.statement,
    x: 'hours',
    y: 'final_score',
    covariate: { kind: 'asserted', column: 'prior_score', confirmed: true },
    direction: 'positive',
    delta: 0.5,
    xUnits: 'hours',
    yUnits: 'points',
    iidAcknowledged: true,
  },
  seed: 19019,
  permutations: 199,
  secondaryOrder: DEFAULT_SECONDARY_ORDER,
  engineSourceDigest: 'a'.repeat(64),
  parentAnalysisId: null,
});
if (!built.ok) throw new Error(built.errors.join('; '));
const { protocol, hash } = built;
const attempts = runFull(fixture.table, protocol);

function completed(list: TerminalAttempt[]): ExecutionRecord {
  const execution = newExecution('analysis', hash, { kind: 'full' }, null);
  execution.attempts = list;
  execution.status = 'completed';
  return execution;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('GroundingGate', () => {
  it('accepts an honest execution after a JSON round trip', () => {
    expect(validateExecution(clone(completed(attempts)), protocol, hash)).toEqual([]);
  });

  it('rejects a tampered number (payload hash and interval consistency)', () => {
    const tampered = clone(attempts);
    const payload = tampered[1].payload as { fit: { hi: number } };
    payload.fit.hi += 1;
    expect(validateAttempt(tampered[1], protocol).length).toBeGreaterThan(0);
  });

  it('rejects an attempt moved to another ordinal', () => {
    const moved = clone(attempts);
    moved[2] = { ...moved[2], ordinal: 3 };
    expect(validateExecution(completed(moved), protocol, hash).length).toBeGreaterThan(0);
  });

  it('treats a missing slot in a completed execution as an integrity failure', () => {
    const errors = validateExecution(completed(attempts.slice(0, 4)), protocol, hash);
    expect(errors.join(' ')).toMatch(/missing a terminal record/);
    expect(headlineFor(protocol, [], errors).code).toBe('integrity_error');
  });

  it('rejects an execution bound to another protocol hash', () => {
    const execution = completed(attempts);
    execution.protocolHash = 'f'.repeat(64);
    expect(validateExecution(execution, protocol, hash).length).toBeGreaterThan(0);
  });

  it('rejects a non-result outcome that carries numbers', () => {
    const bad = clone(attempts);
    bad[3] = { ...bad[3], outcome: 'error' };
    expect(validateAttempt(bad[3], protocol).join(' ')).toMatch(/carries numbers/);
  });
});

describe('ReportFacts', () => {
  it('resolves every number the templates need and fails loudly on a missing reference', () => {
    const book = new FactBook(factsFor(completed(attempts), protocol));
    expect(book.get(0, 'fit.estimate').unit).toBe('points per hours');
    expect(() => book.get(0, 'fit.nonexistent')).toThrow();
  });
});

describe('cancellation and interruption', () => {
  it('terminalizes started and unstarted slots differently without inventing start times', () => {
    const execution = newExecution('analysis', hash, { kind: 'full' }, null);
    execution.attempts = [attempts[0]];
    observe(execution, 'attempt_started', 0);
    observe(execution, 'attempt_finished', 0);
    observe(execution, 'attempt_started', 1);
    execution.status = 'cancelled';
    terminalizeUnresolved(execution, protocol, 'cancelled');
    expect(execution.attempts.map((a) => a.outcome)).toEqual(['baseline_reproduced', 'cancelled', 'cancelled', 'cancelled', 'cancelled']);
    expect(execution.attempts[1].reasonCode).toBe('cancelled_while_running');
    expect(execution.attempts[2].reasonCode).toBe('not_started_cancelled');
    expect(execution.events.filter((event) => event.type === 'attempt_started')).toHaveLength(2);
    expect(validateExecution(execution, protocol, hash)).toEqual([]);
    expect(headlineFor(protocol, execution.attempts).code).toBe('inconclusive');
  });
});

describe('replay diff', () => {
  it('matches an identical rerun and reports the exact differing field otherwise', () => {
    const rerun = runFull(fixture.table, protocol);
    expect(diffAttempts(attempts[1], rerun[1])).toEqual([]);
    const changed = clone(rerun[1]);
    (changed.payload as { fit: { se: number; df: number } }).fit.se *= 1.001;
    (changed.payload as { fit: { se: number; df: number } }).fit.df += 1;
    const paths = diffAttempts(attempts[1], changed).map((diff) => diff.path);
    expect(paths).toContain('payload.fit.se');
    expect(paths).toContain('payload.fit.df');
  });
});
