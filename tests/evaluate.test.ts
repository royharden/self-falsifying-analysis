import { describe, expect, it } from 'vitest';
import { scoreCase } from '../src/lib/falsify/evaluate';
import { generateCase, workshopDemo } from '../src/lib/falsify/generate';
import { BENCH_REPLICATES, buildDeterministicPlan } from '../src/lib/falsify/planSchema';
import { runAnalysis } from '../src/lib/falsify/runner';
import type { AnalysisRun } from '../src/lib/falsify/types';

function fakeRun(verdict: AnalysisRun['verdict'], undermines: boolean): AnalysisRun {
  return {
    plan: {
      planner: 'deterministic',
      seed: 1,
      alpha: 0.05,
      placeboReplicates: 19,
      rationale: null,
      programs: [],
    },
    attempts: [
      {
        ordinal: 0,
        kind: 'naive',
        program: {
          kind: 'naive',
          seed: 1,
          predictor: 'x',
          outcome: 'y',
          direction: 'positive',
          alpha: 0.05,
          placeboReplicates: 19,
          subsetFolds: 3,
          confounder: null,
          spec: 'rank',
        },
        sourceText: '',
        estimate: 0.8,
        standardError: 0.1,
        pValue: 0.01,
        n: 40,
        degreesOfFreedom: 38,
        supportsClaim: true,
        undermines: false,
        reason: '',
        details: {},
        error: null,
      },
      {
        ordinal: 1,
        kind: 'confounder_control',
        program: {
          kind: 'confounder_control',
          seed: 1,
          predictor: 'x',
          outcome: 'y',
          direction: 'positive',
          alpha: 0.05,
          placeboReplicates: 19,
          subsetFolds: 3,
          confounder: 'z',
          spec: 'rank',
        },
        sourceText: '',
        estimate: 0.01,
        standardError: 0.1,
        pValue: 0.9,
        n: 40,
        degreesOfFreedom: 37,
        supportsClaim: !undermines,
        undermines,
        reason: '',
        details: {},
        error: null,
      },
    ],
    verdict,
    fisherP: null,
    adjusted: [],
    eProduct: null,
    eProductCapped: false,
    summary: '',
  };
}

describe('evaluation', () => {
  it('counts a survived noise case as a false positive and a quiet one as quiet', () => {
    const survived = scoreCase('noise', 4, fakeRun('survived', false), 0);
    const quiet = scoreCase('noise', 4, fakeRun('unsupported', false), 0);
    expect(survived.falsePositive).toBe(true);
    expect(survived.quietOnNoise).toBe(false);
    expect(quiet.quietOnNoise).toBe(true);
    expect(quiet.falsePositive).toBe(false);
  });

  it('requires the confounder attack before a spurious case counts as rejected', () => {
    const rejected = scoreCase('planted_spurious', 4, fakeRun('falsified', true), 0);
    const missed = scoreCase('planted_spurious', 4, fakeRun('falsified', false), 0);
    expect(rejected.rejectedSpurious).toBe(true);
    expect(missed.rejectedSpurious).toBe(false);
    expect(missed.falsePositive).toBe(false);
  });

  it('keeps a planted real effect and falsifies the workshop demo', () => {
    const planted = generateCase('planted_real', 7, 200);
    const plantedPlan = buildDeterministicPlan(planted.table, planted.claim, {
      seed: 7,
      placeboReplicates: BENCH_REPLICATES,
    });
    expect(plantedPlan.ok).toBe(true);
    if (!plantedPlan.ok) return;
    const plantedRun = runAnalysis(planted.table, plantedPlan.plan);
    const plantedScore = scoreCase('planted_real', 7, plantedRun, planted.structuralSlope);
    expect(plantedRun.verdict).toBe('survived');
    expect(plantedScore.keptReal).toBe(true);

    const demo = workshopDemo();
    const demoPlan = buildDeterministicPlan(demo.table, demo.claim, {
      seed: 19019,
      placeboReplicates: BENCH_REPLICATES,
    });
    expect(demoPlan.ok).toBe(true);
    if (!demoPlan.ok) return;
    const demoRun = runAnalysis(demo.table, demoPlan.plan);
    const confounder = demoRun.attempts.find((attempt) => attempt.kind === 'confounder_control');
    expect(demoRun.verdict).toBe('falsified');
    expect(confounder?.undermines).toBe(true);
    expect(confounder?.program.confounder).toBe('prior_score');
  });
});
