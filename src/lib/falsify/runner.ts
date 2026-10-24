import { aggregateAttempts } from './aggregate';
import { runAttack } from './attacks';
import type { AnalysisRun, AttemptResult, FrozenPlan, Table } from './types';

export function runAnalysis(table: Table, plan: FrozenPlan): AnalysisRun {
  const attempts = plan.programs.map((program, ordinal) => runAttack(table, program, ordinal));
  return { plan, attempts, ...aggregateAttempts(attempts) };
}

export function rerunProgram(table: Table, plan: FrozenPlan, ordinal: number): AttemptResult | null {
  const program = plan.programs[ordinal];
  if (!program) return null;
  return runAttack(table, program, ordinal);
}

export function attemptsMatch(stored: AttemptResult, rerun: AttemptResult, tolerance = 1e-9): boolean {
  if (stored.kind !== rerun.kind || stored.n !== rerun.n) return false;
  if (stored.undermines !== rerun.undermines || stored.supportsClaim !== rerun.supportsClaim) return false;
  if (stored.error !== rerun.error) return false;
  return close(stored.estimate, rerun.estimate, tolerance) && close(stored.pValue, rerun.pValue, tolerance);
}

function close(left: number | null, right: number | null, tolerance: number): boolean {
  if (left === null || right === null) return left === right;
  if (Object.is(left, right)) return true;
  return Math.abs(left - right) <= tolerance;
}
