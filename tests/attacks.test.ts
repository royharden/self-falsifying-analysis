import { describe, expect, it } from 'vitest';
import { runAttack, selectConfounder } from '../src/lib/falsify/attacks';
import { buildDeterministicPlan, programFor } from '../src/lib/falsify/planSchema';
import { attemptsMatch, rerunProgram, runAnalysis } from '../src/lib/falsify/runner';
import type { ClaimSpec, Table } from '../src/lib/falsify/types';

const z = [1, 1, 1, 1, -1, -1, -1, -1];
const shock = [1, -1, 1, -1, 1, -1, 1, -1];
const x = z.map((value, index) => value + 0.5 * shock[index]);

const spurious: Table = {
  columns: ['x', 'y', 'z', 'decoy'],
  rows: x.map((value, index) => [value, z[index], z[index], shock[index]]),
};

const claim: ClaimSpec = {
  statement: 'x raises y.',
  outcome: 'y',
  predictor: 'x',
  direction: 'positive',
  confounder: null,
};

describe('attacks', () => {
  it('picks the column that tracks both sides of a spurious association', () => {
    expect(selectConfounder(spurious, claim)).toBe('z');
  });

  it('falsifies the hand-built spurious table and reruns the same program', () => {
    const planned = buildDeterministicPlan(spurious, claim, { seed: 11, alpha: 0.05, placeboReplicates: 19 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const run = runAnalysis(spurious, planned.plan);
    const naive = run.attempts.find((attempt) => attempt.kind === 'naive');
    const confounder = run.attempts.find((attempt) => attempt.kind === 'confounder_control');
    expect(naive?.supportsClaim).toBe(true);
    expect(naive?.estimate).toBeCloseTo(0.8, 8);
    expect(confounder?.undermines).toBe(true);
    expect(confounder?.estimate).toBe(0);
    expect(confounder?.program.confounder).toBe('z');
    expect(run.verdict).toBe('falsified');
    const rerun = rerunProgram(spurious, planned.plan, confounder?.ordinal ?? -1);
    expect(rerun).not.toBeNull();
    if (!confounder || !rerun) return;
    expect(attemptsMatch(confounder, rerun)).toBe(true);
    expect(rerun.sourceText).toBe(confounder.sourceText);
  });

  it('keeps a placebo p-value inside (0, 1]', () => {
    const planned = buildDeterministicPlan(spurious, claim, { seed: 3, placeboReplicates: 19 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const placebo = runAnalysis(spurious, planned.plan).attempts.find((attempt) => attempt.kind === 'placebo_shuffle');
    expect(placebo?.pValue).toBeGreaterThan(0);
    expect(placebo?.pValue).toBeLessThanOrEqual(1);
  });

  it('does not treat a collinear control as an undermine', () => {
    const table: Table = {
      columns: ['x', 'y', 'z'],
      rows: Array.from({ length: 8 }, (_, index) => [index + 1, index + 2, index + 1]),
    };
    const program = programFor('confounder_control', { ...claim, confounder: 'z' }, 1, 0.05, 19, 'z');
    const attempt = runAttack(table, program, 0);
    expect(attempt.error).toBe('Predictor has no variation.');
    expect(attempt.undermines).toBe(false);
  });
});
