/**
 * The five fixed recipes (PLAN.md 3.2 and 3.4). Each returns one terminal record.
 * Numbers come only from a completed computation; failures carry a reason and no payload.
 */
import { claimedInterval, claimedSign } from './aggregate';
import { canonicalHash } from './canonical';
import { baselineDetail, fitAdjusted, fitBaseline } from './ols';
import { recipeHash } from './planSchema';
import { mulberry32 } from './prng';
import { averageRanks, mean } from './stats';
import { columnValues } from './table';
import type {
  AttemptPayload,
  OutcomeClass,
  ProtocolV1,
  RecipeV1,
  Table,
  TerminalAttempt,
} from './types';
import { RECIPE_KINDS } from './types';

type Terminal = { outcome: OutcomeClass; reasonCode: string; reason: string; payload: AttemptPayload | null };

export function terminalHash(terminal: Terminal): string {
  return canonicalHash({
    outcome: terminal.outcome,
    reasonCode: terminal.reasonCode,
    reason: terminal.reason,
    payload: terminal.payload,
  });
}

export function finalize(recipe: RecipeV1, terminal: Terminal): TerminalAttempt {
  return {
    ordinal: recipe.ordinal,
    kind: recipe.kind,
    role: recipe.role,
    recipeHash: recipeHash(recipe),
    outcome: terminal.outcome,
    reasonCode: terminal.reasonCode,
    reason: terminal.reason,
    payload: terminal.payload,
    payloadHash: terminalHash(terminal),
  };
}

/** A terminal record for a slot that did not produce a result (cancel, timeout, interruption). */
export function nonResult(
  recipe: RecipeV1,
  outcome: 'cancelled' | 'interrupted' | 'error',
  reasonCode: string,
  reason: string,
): TerminalAttempt {
  return finalize(recipe, { outcome, reasonCode, reason, payload: null });
}

const notAssessed = (outcome: 'inapplicable' | 'error', reasonCode: string, reason: string): Terminal => ({
  outcome,
  reasonCode,
  reason,
  payload: null,
});

/** Runs recipe `ordinal` of a frozen protocol on the exact table rows. */
export function runRecipe(table: Table, protocol: ProtocolV1, ordinal: number): TerminalAttempt {
  const recipe = protocol.recipes[ordinal];
  if (!recipe || recipe.ordinal !== ordinal || recipe.kind !== RECIPE_KINDS[ordinal]) {
    throw new Error(`Recipe ${ordinal} does not match its canonical ordinal.`);
  }
  let terminal: Terminal;
  try {
    terminal = execute(table, protocol, recipe);
  } catch (error) {
    terminal = notAssessed('error', 'exception', error instanceof Error ? error.message.slice(0, 300) : 'Unexpected failure.');
  }
  return finalize(recipe, terminal);
}

function execute(table: Table, protocol: ProtocolV1, recipe: RecipeV1): Terminal {
  const { x: xName, y: yName } = recipe.parameters;
  const x = columnValues(table, xName);
  const y = columnValues(table, yName);
  if (!x || !y) return notAssessed('error', 'column_missing', 'The predictor or outcome column is missing from the table.');
  switch (recipe.kind) {
    case 'baseline_ols':
      return baseline(x, y, recipe);
    case 'adjusted_ols':
      return adjusted(table, x, y, recipe, protocol.minResidualVarianceRatio);
    case 'influence':
      return influence(x, y, recipe, protocol);
    case 'rank_sensitivity':
      return rank(x, y, recipe);
    case 'predictor_permutation':
      return permutation(x, y, recipe);
    default: {
      const unreachable: never = recipe.kind;
      return notAssessed('error', 'unknown_recipe', `Unknown recipe ${String(unreachable)}.`);
    }
  }
}

function baseline(x: number[], y: number[], recipe: RecipeV1): Terminal {
  const fit = fitBaseline(x, y);
  if ('failure' in fit) return notAssessed('inapplicable', fit.reasonCode, fit.failure);
  const claimed = claimedInterval(fit.lo, fit.hi, recipe.parameters.direction, recipe.parameters.delta);
  const outcome: OutcomeClass =
    claimed.state === 'above' ? 'baseline_reproduced' : claimed.state === 'below' ? 'baseline_not_reproduced' : 'inconclusive';
  const reason =
    claimed.state === 'above'
      ? 'The claimed-direction 95% interval lies above δ.'
      : claimed.state === 'below'
        ? 'The claimed-direction 95% interval lies below δ.'
        : 'The claimed-direction 95% interval touches or contains δ.';
  return { outcome, reasonCode: `interval_${claimed.state}`, reason, payload: { kind: 'baseline_ols', fit, claimed } };
}

function adjusted(table: Table, x: number[], y: number[], recipe: RecipeV1, minRatio: number): Terminal {
  const zName = recipe.parameters.z;
  if (zName === null) {
    return notAssessed('inapplicable', 'no_covariate', 'No defensible covariate was declared, so confounding is not assessed.');
  }
  const z = columnValues(table, zName);
  if (!z) return notAssessed('error', 'column_missing', 'The covariate column is missing from the table.');
  const result = fitAdjusted(x, y, z, minRatio);
  if ('failure' in result) return notAssessed('inapplicable', result.reasonCode, result.failure);
  const claimed = claimedInterval(result.fit.lo, result.fit.hi, recipe.parameters.direction, recipe.parameters.delta);
  const outcome: OutcomeClass =
    claimed.state === 'below' ? 'challenged_primary' : claimed.state === 'above' ? 'retained_primary' : 'inconclusive';
  const reason =
    claimed.state === 'below'
      ? `Adjusted for ${zName}, the claimed-direction 95% interval lies below δ.`
      : claimed.state === 'above'
        ? `Adjusted for ${zName}, the claimed-direction 95% interval still lies above δ.`
        : `Adjusted for ${zName}, the claimed-direction 95% interval touches or contains δ.`;
  return {
    outcome,
    reasonCode: `interval_${claimed.state}`,
    reason,
    payload: {
      kind: 'adjusted_ols',
      covariate: zName,
      fit: result.fit,
      claimed,
      residualVarianceRatio: result.residualVarianceRatio,
    },
  };
}

function influence(x: number[], y: number[], recipe: RecipeV1, protocol: ProtocolV1): Terminal {
  const policy = protocol.influence;
  const detail = baselineDetail(x, y);
  if ('failure' in detail) return notAssessed('inapplicable', detail.reasonCode, detail.failure);
  const n = x.length;
  if (detail.mse === 0) return notAssessed('inapplicable', 'zero_mse', 'The baseline fit is exact (zero residual variance), so Cook’s distance is undefined.');
  const threshold = policy.cookMultiplier / n;
  const candidates: number[] = [];
  let maxCookD = 0;
  for (let i = 0; i < n; i += 1) {
    const h = 1 / n + (detail.dx[i] * detail.dx[i]) / detail.sxx;
    if (1 - h <= 1e-12) return notAssessed('inapplicable', 'leverage_near_one', `Row ${i + 1} has leverage too close to 1.`);
    const e = detail.residuals[i];
    const d = ((e * e) / (2 * detail.mse)) * (h / ((1 - h) * (1 - h)));
    if (!Number.isFinite(d)) return notAssessed('inapplicable', 'nonfinite_cook', 'Cook’s distance was not finite.');
    if (d > maxCookD) maxCookD = d;
    if (d > threshold) candidates.push(i);
  }
  const base = {
    kind: 'influence' as const,
    nOriginal: n,
    threshold,
    maxCookD,
    candidates,
  };
  if (candidates.length === 0) {
    return {
      outcome: 'no_flag',
      reasonCode: 'no_candidates',
      reason: `No row has Cook’s distance above ${policy.cookMultiplier}/n.`,
      payload: { ...base, nReduced: null, reduced: null, reducedClaimed: null, differenceFromOriginal: null, reversed: null },
    };
  }
  const cap = Math.floor(policy.maxCandidateFraction * n);
  if (candidates.length > cap) {
    return notAssessed(
      'inapplicable',
      'too_many_candidates',
      `${candidates.length} rows exceed ${policy.cookMultiplier}/n, more than the ${cap}-row cap; removing them would change the sample too much.`,
    );
  }
  const removed = new Set(candidates);
  const keep = x.map((_, index) => index).filter((index) => !removed.has(index));
  if (keep.length < policy.minRetainedRows) {
    return notAssessed('inapplicable', 'too_few_retained', `Only ${keep.length} rows would remain.`);
  }
  const reduced = fitBaseline(
    keep.map((index) => x[index]),
    keep.map((index) => y[index]),
  );
  if ('failure' in reduced) return notAssessed('inapplicable', reduced.reasonCode, `Reduced fit: ${reduced.failure}`);
  const reducedClaimed = claimedInterval(reduced.lo, reduced.hi, recipe.parameters.direction, recipe.parameters.delta);
  const reversed = claimedSign(recipe.parameters.direction) * reduced.estimate < 0;
  const flagged = reducedClaimed.state === 'below' || reversed;
  return {
    outcome: flagged ? 'sensitivity_flag' : 'no_flag',
    reasonCode: flagged ? (reversed ? 'reduced_reverses' : 'reduced_below_delta') : 'reduced_holds',
    reason: flagged
      ? `Without the ${candidates.length} high-influence row(s) the descriptive interval ${reversed ? 'reverses direction' : 'falls below δ'}.`
      : `Without the ${candidates.length} high-influence row(s) the descriptive interval does not fall below δ.`,
    payload: {
      ...base,
      nReduced: keep.length,
      reduced,
      reducedClaimed,
      differenceFromOriginal: reduced.estimate - detail.fit.estimate,
      reversed,
    },
  };
}

function rank(x: number[], y: number[], recipe: RecipeV1): Terminal {
  const rx = averageRanks(x);
  const ry = averageRanks(y);
  if (ry.every((value) => value === ry[0])) {
    return notAssessed('inapplicable', 'constant_outcome_ranks', 'The outcome ranks have no variation.');
  }
  const fit = fitBaseline(rx, ry);
  if ('failure' in fit) return notAssessed('inapplicable', fit.reasonCode, fit.failure);
  const reversed = claimedSign(recipe.parameters.direction) * fit.estimate < 0;
  const intervalContainsZero = fit.lo <= 0 && fit.hi >= 0;
  return {
    outcome: reversed ? 'sensitivity_flag' : 'no_flag',
    reasonCode: reversed ? 'rank_reverses' : 'rank_same_direction',
    reason: reversed
      ? 'The rank-on-rank slope points opposite to the claim.'
      : intervalContainsZero
        ? 'The rank-on-rank slope points the claimed way, but its working interval contains zero (direction inconclusive).'
        : 'The rank-on-rank slope points the claimed way.',
    payload: { kind: 'rank_sensitivity', fit, reversed, intervalContainsZero },
  };
}

function permutation(x: number[], y: number[], recipe: RecipeV1): Terminal {
  const permutations = recipe.parameters.permutations;
  const seed = recipe.parameters.permutationSeed;
  if (permutations === null || seed === null) return notAssessed('error', 'missing_parameters', 'Permutation parameters are missing.');
  const detail = baselineDetail(x, y);
  if ('failure' in detail) return notAssessed('inapplicable', detail.reasonCode, detail.failure);
  const n = y.length;
  const my = mean(y);
  const dy = y.map((value) => value - my);
  const shuffled = detail.dx.slice();
  // Observed statistic through the same summation as the replicates, so ties compare exactly.
  const observedAbsSlope = Math.abs(crossSum(shuffled, dy) / detail.sxx);
  const rng = mulberry32(seed);
  let exceedances = 0;
  for (let replicate = 0; replicate < permutations; replicate += 1) {
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    if (Math.abs(crossSum(shuffled, dy) / detail.sxx) >= observedAbsSlope) exceedances += 1;
  }
  const tailProportion = (1 + exceedances) / (permutations + 1);
  return {
    outcome: 'no_flag',
    reasonCode: 'diagnostic_only',
    reason: `${exceedances} of ${permutations} predictor shuffles gave an absolute slope at least as large. Diagnostic only; it does not refute confounding or undo prior claim selection.`,
    payload: { kind: 'predictor_permutation', permutations, seed, observedAbsSlope, exceedances, tailProportion },
  };
}

/** Neumaier-compensated sum of products. */
function crossSum(left: readonly number[], right: readonly number[]): number {
  let sum = 0;
  let correction = 0;
  for (let i = 0; i < left.length; i += 1) {
    const value = left[i] * right[i];
    const next = sum + value;
    if (Math.abs(sum) >= Math.abs(value)) correction += sum - next + value;
    else correction += value - next + sum;
    sum = next;
  }
  return sum + correction;
}
