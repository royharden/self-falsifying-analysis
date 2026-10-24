import { partialSlope, simpleSlope } from './ols';
import { fisherYates, mulberry32 } from './prng';
import { renderSource } from './sourceText';
import { averageRanks, pearson } from './stats';
import { columnValues } from './table';
import type { AttackProgram, AttemptResult, ClaimSpec, Direction, Fit, Table } from './types';

const MIN_ROWS = 8;

export function selectConfounder(table: Table, claim: ClaimSpec): string | null {
  if (claim.confounder) {
    const named = claim.confounder;
    if (table.columns.includes(named) && named !== claim.predictor && named !== claim.outcome) return named;
    return null;
  }
  const y = columnValues(table, claim.outcome);
  const x = columnValues(table, claim.predictor);
  if (!y || !x) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const name of table.columns) {
    if (name === claim.outcome || name === claim.predictor) continue;
    const z = columnValues(table, name);
    if (!z) continue;
    const withX = pearson(z, x);
    const withY = pearson(z, y);
    if (withX === null || withY === null) continue;
    const score = Math.abs(withX) * Math.abs(withY);
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

export function signSupports(estimate: number, direction: Direction): boolean {
  if (direction === 'positive') return estimate > 0;
  if (direction === 'negative') return estimate < 0;
  return estimate !== 0;
}

export function parametricSupports(fit: Fit, direction: Direction, alpha: number): boolean {
  return signSupports(fit.estimate, direction) && fit.pValue < alpha;
}

function favorable(estimate: number, direction: Direction): number {
  if (direction === 'negative') return -estimate;
  if (direction === 'nonzero') return Math.abs(estimate);
  return estimate;
}

function blank(program: AttackProgram, ordinal: number, n: number): AttemptResult {
  return {
    ordinal,
    kind: program.kind,
    program,
    sourceText: renderSource(program),
    estimate: null,
    standardError: null,
    pValue: null,
    n,
    degreesOfFreedom: null,
    supportsClaim: false,
    undermines: false,
    reason: '',
    details: {},
    error: null,
  };
}

function fail(program: AttackProgram, ordinal: number, n: number, error: string): AttemptResult {
  const result = blank(program, ordinal, n);
  result.error = error;
  result.reason = error;
  return result;
}

function fillFit(result: AttemptResult, fit: Fit, supports: boolean, undermines: boolean, reason: string): AttemptResult {
  result.estimate = fit.estimate;
  result.standardError = fit.standardError;
  result.pValue = fit.pValue;
  result.degreesOfFreedom = fit.df;
  result.supportsClaim = supports;
  result.undermines = undermines;
  result.reason = reason;
  result.details = {
    intercept: fit.intercept,
    rSquared: fit.rSquared,
    exactFit: !Number.isFinite(fit.tStatistic),
  };
  return result;
}

export function runAttack(table: Table, program: AttackProgram, ordinal: number): AttemptResult {
  const y = columnValues(table, program.outcome);
  const x = columnValues(table, program.predictor);
  if (!y || !x) return fail(program, ordinal, table.rows.length, 'Outcome or predictor column is missing.');
  if (program.outcome === program.predictor) {
    return fail(program, ordinal, y.length, 'Outcome and predictor must be different columns.');
  }
  if (y.length < MIN_ROWS) return fail(program, ordinal, y.length, 'Need at least 8 rows.');
  switch (program.kind) {
    case 'naive':
      return runNaive(program, ordinal, y, x);
    case 'placebo_shuffle':
      return runPlacebo(program, ordinal, y, x);
    case 'subset_stability':
      return runSubset(program, ordinal, y, x);
    case 'confounder_control':
      return runConfounder(table, program, ordinal, y, x);
    case 'alternative_spec':
      return runRank(program, ordinal, y, x);
    default: {
      const unreachable: never = program.kind;
      return fail(program, ordinal, y.length, `Unknown attack ${String(unreachable)}.`);
    }
  }
}

function runNaive(program: AttackProgram, ordinal: number, y: number[], x: number[]): AttemptResult {
  const fit = simpleSlope(y, x);
  if ('error' in fit) return fail(program, ordinal, y.length, fit.error);
  const supports = parametricSupports(fit, program.direction, program.alpha);
  const reason = supports
    ? 'The ordinary slope matches the claim and its two-sided p-value is below alpha.'
    : 'The ordinary slope does not establish the claim.';
  return fillFit(blank(program, ordinal, fit.n), fit, supports, false, reason);
}

function runPlacebo(program: AttackProgram, ordinal: number, y: number[], x: number[]): AttemptResult {
  const observed = simpleSlope(y, x);
  if ('error' in observed) return fail(program, ordinal, y.length, observed.error);
  const replicates = program.placeboReplicates;
  if (!Number.isInteger(replicates) || replicates < 19 || replicates > 499) {
    return fail(program, ordinal, y.length, 'Placebo replicates must be an integer from 19 to 499.');
  }
  const rng = mulberry32(program.seed);
  const observedFavorable = favorable(observed.estimate, program.direction);
  let asExtreme = 0;
  const shuffled = x.slice();
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    const fit = simpleSlope(y, shuffled);
    if ('error' in fit) continue;
    if (favorable(fit.estimate, program.direction) >= observedFavorable - 1e-12) asExtreme += 1;
  }
  const pValue = (1 + asExtreme) / (1 + replicates);
  const supports = signSupports(observed.estimate, program.direction) && pValue < program.alpha;
  const result = blank(program, ordinal, observed.n);
  result.estimate = observed.estimate;
  result.standardError = observed.standardError;
  result.pValue = pValue;
  result.degreesOfFreedom = observed.df;
  result.supportsClaim = supports;
  result.undermines = !supports;
  result.reason = supports
    ? 'The observed slope is more claim-favorable than the shuffled predictor.'
    : 'Shuffling the predictor still produces slopes at least as claim-favorable.';
  result.details = { asExtreme, replicates, parametricP: observed.pValue };
  return result;
}

function runSubset(program: AttackProgram, ordinal: number, y: number[], x: number[]): AttemptResult {
  if (program.subsetFolds !== 3) return fail(program, ordinal, y.length, 'Subset attack uses three folds.');
  if (y.length < 12) return fail(program, ordinal, y.length, 'Need at least 12 rows for three subsets.');
  const order = fisherYates(
    y.map((_, index) => index),
    mulberry32(program.seed),
  );
  const groups: number[][] = [[], [], []];
  order.forEach((row, index) => groups[index % 3].push(row));
  const slopes: number[] = [];
  for (const group of groups) {
    if (group.length < 4) return fail(program, ordinal, y.length, 'A subset has fewer than 4 rows.');
    const fit = simpleSlope(
      group.map((index) => y[index]),
      group.map((index) => x[index]),
    );
    if ('error' in fit) return fail(program, ordinal, y.length, `A subset could not be fit: ${fit.error}`);
    slopes.push(fit.estimate);
  }
  const disagrees = slopes.some((slope) => !signSupports(slope, program.direction));
  const result = blank(program, ordinal, y.length);
  result.estimate = slopes.reduce((sum, slope) => sum + slope, 0) / slopes.length;
  result.supportsClaim = !disagrees;
  result.undermines = disagrees;
  result.reason = disagrees
    ? 'At least one third of the rows loses the claimed sign.'
    : 'Each third of the rows keeps the claimed sign.';
  result.details = { fold0: slopes[0], fold1: slopes[1], fold2: slopes[2] };
  return result;
}

function runConfounder(
  table: Table,
  program: AttackProgram,
  ordinal: number,
  y: number[],
  x: number[],
): AttemptResult {
  const name = program.confounder;
  if (!name) return fail(program, ordinal, y.length, 'No confounder column is available.');
  if (name === program.predictor || name === program.outcome) {
    return fail(program, ordinal, y.length, 'The confounder must be a different column.');
  }
  const z = columnValues(table, name);
  if (!z) return fail(program, ordinal, y.length, 'Confounder column is missing.');
  const fit = partialSlope(y, x, z);
  if ('error' in fit) return fail(program, ordinal, y.length, fit.error);
  const supports = parametricSupports(fit, program.direction, program.alpha);
  const result = fillFit(
    blank(program, ordinal, fit.n),
    fit,
    supports,
    !supports,
    supports
      ? `The slope on ${program.predictor} still matches the claim after controlling for ${name}.`
      : `Controlling for ${name} removes the claimed association.`,
  );
  result.details = { ...result.details, confounder: name };
  return result;
}

function runRank(program: AttackProgram, ordinal: number, y: number[], x: number[]): AttemptResult {
  if (program.spec !== 'rank') return fail(program, ordinal, y.length, 'The only alternate specification is a rank transform.');
  const fit = simpleSlope(averageRanks(y), averageRanks(x));
  if ('error' in fit) return fail(program, ordinal, y.length, fit.error);
  const supports = parametricSupports(fit, program.direction, program.alpha);
  return fillFit(
    blank(program, ordinal, fit.n),
    fit,
    supports,
    !supports,
    supports
      ? 'The rank specification still matches the claim.'
      : 'The rank specification does not keep the claimed association.',
  );
}
