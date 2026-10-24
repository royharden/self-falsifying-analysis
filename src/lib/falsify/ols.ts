import { studentTTwoSidedP } from './stats';
import type { Fit, FitError } from './types';

const EXACT_SSE = 1e-12;

/**
 * OLS slope of y on x with an intercept.
 * extraControls subtracts further parameters already removed from both series
 * (Frisch-Waugh-Lovell), so a one-confounder partial slope uses extraControls = 1
 * and df = n - 3.
 */
export function simpleSlope(y: readonly number[], x: readonly number[], extraControls = 0): Fit | FitError {
  const n = y.length;
  if (x.length !== n) return { error: 'Column lengths differ.' };
  const df = n - 2 - extraControls;
  if (df < 1) return { error: 'Not enough rows for this fit.' };
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) return { error: 'Non-finite value.' };
    meanX += x[i];
    meanY += y[i];
  }
  meanX /= n;
  meanY /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx <= 1e-18) return { error: 'Predictor has no variation.' };
  const estimate = sxy / sxx;
  const intercept = meanY - estimate * meanX;
  let sse = 0;
  for (let i = 0; i < n; i += 1) {
    const residual = y[i] - (intercept + estimate * x[i]);
    sse += residual * residual;
  }
  const rSquared = syy <= 1e-18 ? 1 : 1 - sse / syy;
  if (sse <= EXACT_SSE * (syy + 1)) {
    if (Math.abs(estimate) <= 1e-10) {
      return {
        estimate: 0,
        intercept,
        standardError: 0,
        tStatistic: 0,
        pValue: 1,
        n,
        df,
        rSquared: 0,
      };
    }
    return {
      estimate,
      intercept,
      standardError: 0,
      tStatistic: estimate > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
      pValue: 0,
      n,
      df,
      rSquared: 1,
    };
  }
  const sigma2 = sse / df;
  const standardError = Math.sqrt(sigma2 / sxx);
  const tStatistic = estimate / standardError;
  const pValue = studentTTwoSidedP(tStatistic, df);
  return { estimate, intercept, standardError, tStatistic, pValue, n, df, rSquared };
}

/** Partial slope of y on x given one control z. Singular when x is linear in z. */
export function partialSlope(y: readonly number[], x: readonly number[], z: readonly number[]): Fit | FitError {
  if (y.length !== z.length || x.length !== z.length) return { error: 'Column lengths differ.' };
  const yOnZ = simpleSlope(y, z, 0);
  const xOnZ = simpleSlope(x, z, 0);
  if ('error' in yOnZ) return yOnZ;
  if ('error' in xOnZ) return xOnZ;
  const yResidual = y.map((value, index) => value - (yOnZ.intercept + yOnZ.estimate * z[index]));
  const xResidual = x.map((value, index) => value - (xOnZ.intercept + xOnZ.estimate * z[index]));
  return simpleSlope(yResidual, xResidual, 1);
}
