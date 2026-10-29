import { compensatedSum, mean, studentTQuantile, studentTTwoSidedP } from './stats';
import type { FitFailure, FitSummary } from './types';

/** Relative SSE below which a fit is treated as exact (SE = 0, point interval). */
export const EXACT_RELATIVE_SSE = 1e-20;
/** Default frozen conditioning guard for the adjusted fit (PLAN.md section 3.2). */
export const MIN_RESIDUAL_VARIANCE_RATIO = 1e-8;

export type BaselineDetail = {
  fit: FitSummary;
  dx: number[];
  residuals: number[];
  sxx: number;
  mse: number;
};

function fail(reasonCode: string, failure: string): FitFailure {
  return { reasonCode, failure };
}

function allFinite(values: readonly number[]): boolean {
  for (const value of values) if (!Number.isFinite(value)) return false;
  return true;
}

function isConstant(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i += 1) if (values[i] !== values[0]) return false;
  return true;
}

function squares(values: readonly number[]): number {
  return compensatedSum(values.map((value) => value * value));
}

function products(left: readonly number[], right: readonly number[]): number {
  return compensatedSum(left.map((value, index) => value * right[index]));
}

function summarize(
  n: number,
  df: number,
  estimate: number,
  sse: number,
  totalResidualSs: number,
  sxx: number,
): { fit: FitSummary; mse: number } | FitFailure {
  const tCrit = studentTQuantile(0.975, df);
  if (!Number.isFinite(tCrit)) return fail('t_quantile_failed', 'The t quantile could not be computed.');
  const exact = totalResidualSs === 0 || sse <= EXACT_RELATIVE_SSE * totalResidualSs;
  if (exact) {
    return {
      mse: 0,
      fit: { n, df, estimate, se: 0, lo: estimate, hi: estimate, tCrit, sse, exact: true, pDescriptive: estimate === 0 ? 1 : 0 },
    };
  }
  const mse = sse / df;
  const se = Math.sqrt(mse / sxx);
  if (!Number.isFinite(se) || !Number.isFinite(estimate)) {
    return fail('nonfinite_fit', 'The fit produced a non-finite value.');
  }
  const halfWidth = tCrit * se;
  return {
    mse,
    fit: {
      n,
      df,
      estimate,
      se,
      lo: estimate - halfWidth,
      hi: estimate + halfWidth,
      tCrit,
      sse,
      exact: false,
      pDescriptive: studentTTwoSidedP(estimate / se, df),
    },
  };
}

/** Centered simple OLS of y on x with an intercept, df = n - 2, classical 95% t interval. */
export function baselineDetail(x: readonly number[], y: readonly number[]): BaselineDetail | FitFailure {
  const n = y.length;
  if (x.length !== n) return fail('length_mismatch', 'Column lengths differ.');
  if (n - 2 < 1) return fail('too_few_rows', 'Not enough rows for this fit.');
  if (!allFinite(x) || !allFinite(y)) return fail('nonfinite_input', 'A value is not finite.');
  if (isConstant(x)) return fail('constant_predictor', 'The predictor has no variation.');
  const mx = mean(x);
  const my = mean(y);
  const dx = x.map((value) => value - mx);
  const dy = y.map((value) => value - my);
  const sxx = squares(dx);
  if (!(sxx > 0)) return fail('constant_predictor', 'The predictor has no numerical variation.');
  const estimate = products(dx, dy) / sxx;
  const residuals = dy.map((value, index) => value - estimate * dx[index]);
  const sse = squares(residuals);
  const syy = squares(dy);
  const result = summarize(n, n - 2, estimate, sse, syy, sxx);
  if ('failure' in result) return result;
  return { fit: result.fit, dx, residuals, sxx, mse: result.mse };
}

export function fitBaseline(x: readonly number[], y: readonly number[]): FitSummary | FitFailure {
  const detail = baselineDetail(x, y);
  return 'failure' in detail ? detail : detail.fit;
}

export type AdjustedFit = { fit: FitSummary; residualVarianceRatio: number };

/**
 * One-control Frisch-Waugh-Lovell: residualize centered x and y on centered z,
 * slope the residuals, SE from the full-model residuals with df = n - 3.
 */
export function fitAdjusted(
  x: readonly number[],
  y: readonly number[],
  z: readonly number[],
  minResidualVarianceRatio = MIN_RESIDUAL_VARIANCE_RATIO,
): AdjustedFit | FitFailure {
  const n = y.length;
  if (x.length !== n || z.length !== n) return fail('length_mismatch', 'Column lengths differ.');
  if (n - 3 < 1) return fail('too_few_rows', 'Not enough rows for this fit.');
  if (!allFinite(x) || !allFinite(y) || !allFinite(z)) return fail('nonfinite_input', 'A value is not finite.');
  if (isConstant(x)) return fail('constant_predictor', 'The predictor has no variation.');
  if (isConstant(z)) return fail('constant_covariate', 'The covariate has no variation.');
  const mx = mean(x);
  const my = mean(y);
  const mz = mean(z);
  const dx = x.map((value) => value - mx);
  const dy = y.map((value) => value - my);
  const dz = z.map((value) => value - mz);
  const szz = squares(dz);
  const sxx = squares(dx);
  if (!(szz > 0)) return fail('constant_covariate', 'The covariate has no numerical variation.');
  if (!(sxx > 0)) return fail('constant_predictor', 'The predictor has no numerical variation.');
  const bxz = products(dx, dz) / szz;
  const byz = products(dy, dz) / szz;
  const xr = dx.map((value, index) => value - bxz * dz[index]);
  const yr = dy.map((value, index) => value - byz * dz[index]);
  const sxxRes = squares(xr);
  const ratio = sxxRes / sxx;
  if (!Number.isFinite(ratio) || ratio < minResidualVarianceRatio) {
    return fail(
      'ill_conditioned',
      `The predictor is almost a linear function of the covariate (residual variance ratio below ${minResidualVarianceRatio}).`,
    );
  }
  const estimate = products(xr, yr) / sxxRes;
  const residuals = yr.map((value, index) => value - estimate * xr[index]);
  const sse = squares(residuals);
  const syyRes = squares(yr);
  const result = summarize(n, n - 3, estimate, sse, syyRes, sxxRes);
  if ('failure' in result) return result;
  return { fit: result.fit, residualVarianceRatio: ratio };
}
