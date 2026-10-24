import { generateCase, type CaseKind, type GeneratedCase } from './generate';
import { BENCH_REPLICATES, buildDeterministicPlan } from './planSchema';
import { mixSeed } from './prng';
import { runAnalysis } from './runner';
import type { AnalysisRun, Verdict } from './types';

export type CaseScore = {
  kind: CaseKind;
  seed: number;
  verdict: Verdict;
  naiveSlope: number | null;
  structuralSlope: number;
  partialSlope: number | null;
  confounderUndermined: boolean;
  keptReal: boolean;
  rejectedSpurious: boolean;
  quietOnNoise: boolean;
  falsePositive: boolean;
};

export type CampaignReport = {
  seed: number;
  replicates: number;
  rowsPerCase: number;
  alpha: number;
  placeboReplicates: number;
  cases: CaseScore[];
  realKept: number;
  realTotal: number;
  spuriousRejected: number;
  spuriousTotal: number;
  noiseQuiet: number;
  noiseTotal: number;
  falsePositives: number;
};

export function scoreCase(kind: CaseKind, seed: number, run: AnalysisRun, structuralSlope: number): CaseScore {
  const naive = run.attempts.find((attempt) => attempt.kind === 'naive' && !attempt.error);
  const confounder = run.attempts.find((attempt) => attempt.kind === 'confounder_control' && !attempt.error);
  const naiveSlope = naive?.estimate ?? null;
  const partialSlope = confounder?.estimate ?? null;
  const confounderUndermined = Boolean(confounder?.undermines);
  const scale = Math.max(Math.abs(structuralSlope), 0.2);
  const closeEnough = naiveSlope !== null && Math.abs(naiveSlope - structuralSlope) / scale <= 0.5;
  const signOk =
    naiveSlope !== null && (structuralSlope === 0 || Math.sign(naiveSlope) === Math.sign(structuralSlope));
  const keptReal = kind === 'planted_real' && run.verdict === 'survived' && signOk && closeEnough;
  const rejectedSpurious = kind === 'planted_spurious' && run.verdict === 'falsified' && confounderUndermined;
  const quietOnNoise = kind === 'noise' && run.verdict !== 'survived';
  const falsePositive = (kind === 'noise' || kind === 'planted_spurious') && run.verdict === 'survived';
  return {
    kind,
    seed,
    verdict: run.verdict,
    naiveSlope,
    structuralSlope,
    partialSlope,
    confounderUndermined,
    keptReal,
    rejectedSpurious,
    quietOnNoise,
    falsePositive,
  };
}

export function scoreGenerated(generated: GeneratedCase, run: AnalysisRun): CaseScore {
  return scoreCase(generated.kind, generated.seed, run, generated.structuralSlope);
}

export function runCampaign(options: {
  seed: number;
  replicates: number;
  rowsPerCase: number;
  alpha?: number;
}): CampaignReport | { error: string } {
  const { replicates, rowsPerCase } = options;
  if (!Number.isInteger(replicates) || replicates < 1 || replicates > 20) {
    return { error: 'Replicates must be an integer from 1 to 20.' };
  }
  if (!Number.isInteger(rowsPerCase) || rowsPerCase < 40 || rowsPerCase > 2000) {
    return { error: 'Each case needs 40 to 2000 rows.' };
  }
  const alpha = options.alpha ?? 0.05;
  const kinds: CaseKind[] = ['noise', 'planted_real', 'planted_spurious'];
  const cases: CaseScore[] = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    for (const kind of kinds) {
      const caseSeed = mixSeed(options.seed, replicate + 1);
      const generated = generateCase(kind, caseSeed, rowsPerCase);
      const planned = buildDeterministicPlan(generated.table, generated.claim, {
        seed: caseSeed,
        alpha,
        placeboReplicates: BENCH_REPLICATES,
      });
      if (!planned.ok) return { error: planned.error };
      const run = runAnalysis(generated.table, planned.plan);
      cases.push(scoreGenerated(generated, run));
    }
  }
  return {
    seed: options.seed,
    replicates,
    rowsPerCase,
    alpha,
    placeboReplicates: BENCH_REPLICATES,
    cases,
    realKept: cases.filter((item) => item.keptReal).length,
    realTotal: cases.filter((item) => item.kind === 'planted_real').length,
    spuriousRejected: cases.filter((item) => item.rejectedSpurious).length,
    spuriousTotal: cases.filter((item) => item.kind === 'planted_spurious').length,
    noiseQuiet: cases.filter((item) => item.quietOnNoise).length,
    noiseTotal: cases.filter((item) => item.kind === 'noise').length,
    falsePositives: cases.filter((item) => item.falsePositive).length,
  };
}
