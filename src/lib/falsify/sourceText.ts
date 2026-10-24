import type { AttackProgram } from './types';

const STEPS: Record<AttackProgram['kind'], string> = {
  naive:
    'Estimate the ordinary least-squares slope of the outcome on the predictor, with an intercept. Two-sided Student t, df = n - 2.',
  placebo_shuffle:
    'Shuffle the predictor with mulberry32(seed) and Fisher-Yates. Permutation p = (1 + shuffles at least as claim-favorable) / (1 + replicates). The estimate is the unshuffled slope.',
  subset_stability:
    'Shuffle row indexes with mulberry32(seed), split them into three folds, and fit each fold. The attack overturns the claim if any fold loses the claimed sign.',
  confounder_control:
    'Residualize the outcome and the predictor on the frozen confounder, then slope the residuals. df = n - 3. The confounder column is part of the program and is not chosen again on rerun.',
  alternative_spec:
    'Replace both columns with average ranks, ties sharing a rank, and estimate the ordinary slope.',
};

export function renderSource(program: AttackProgram): string {
  return [
    '// Reproducible attack record. Rerun executes the program. It does not eval this text.',
    `kind: ${program.kind}`,
    `seed: ${program.seed}`,
    `outcome: ${program.outcome}`,
    `predictor: ${program.predictor}`,
    `direction: ${program.direction}`,
    `alpha: ${program.alpha}`,
    `placeboReplicates: ${program.placeboReplicates}`,
    `subsetFolds: ${program.subsetFolds}`,
    `confounder: ${program.confounder ?? 'none'}`,
    `spec: ${program.spec}`,
    `procedure: ${STEPS[program.kind]}`,
  ].join('\n');
}
