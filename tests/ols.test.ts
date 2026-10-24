import { describe, expect, it } from 'vitest';
import { fitAdjusted, fitBaseline } from '../src/lib/falsify/ols';

const T975_DF1 = Math.tan(Math.PI * 0.475);
const T975_DF2 = 4.302652729749;

describe('baseline OLS (hand-computed)', () => {
  it('x = [1,2,3,4], y = [2,4,5,8]: slope 1.9, SSE 0.7, SE sqrt(0.07), df 2', () => {
    const fit = fitBaseline([1, 2, 3, 4], [2, 4, 5, 8]);
    if ('failure' in fit) throw new Error(fit.failure);
    expect(fit.estimate).toBeCloseTo(1.9, 12);
    expect(fit.sse).toBeCloseTo(0.7, 12);
    expect(fit.df).toBe(2);
    expect(fit.se).toBeCloseTo(Math.sqrt(0.07), 12);
    expect(fit.lo).toBeCloseTo(1.9 - T975_DF2 * Math.sqrt(0.07), 8);
    expect(fit.hi).toBeCloseTo(1.9 + T975_DF2 * Math.sqrt(0.07), 8);
    expect(fit.exact).toBe(false);
  });

  it('is invariant to rescaling the predictor except for the slope scale', () => {
    const x = [1, 2, 3, 4];
    const y = [2, 4, 5, 8];
    const a = fitBaseline(x, y);
    const b = fitBaseline(x.map((v) => v * 1000 + 1e6), y);
    if ('failure' in a || 'failure' in b) throw new Error('fit failed');
    expect(b.estimate * 1000).toBeCloseTo(a.estimate, 9);
    expect(b.se * 1000).toBeCloseTo(a.se, 9);
  });

  it('treats an exact line as an exact fit with SE 0 and a point interval', () => {
    const fit = fitBaseline([1, 2, 3, 4, 5], [3, 5, 7, 9, 11]);
    if ('failure' in fit) throw new Error(fit.failure);
    expect(fit.exact).toBe(true);
    expect(fit.se).toBe(0);
    expect(fit.lo).toBe(fit.hi);
    expect(fit.estimate).toBeCloseTo(2, 12);
  });

  it('allows a constant outcome as the zero-slope, zero-SE limit', () => {
    const fit = fitBaseline([1, 2, 3, 4], [7, 7, 7, 7]);
    if ('failure' in fit) throw new Error(fit.failure);
    expect(fit.estimate).toBe(0);
    expect(fit.se).toBe(0);
    expect(fit.exact).toBe(true);
  });

  it('rejects a constant predictor', () => {
    const fit = fitBaseline([3, 3, 3, 3], [1, 2, 3, 4]);
    expect('failure' in fit && fit.reasonCode).toBe('constant_predictor');
  });
});

describe('one-control FWL (hand-constructed orthogonal design)', () => {
  // z, w, e are mutually orthogonal and mean zero.
  const z = [1, 1, -1, -1];
  const w = [1, -1, 1, -1];
  const e = [1, -1, -1, 1];
  const x = z.map((value, i) => value + w[i]);

  it('recovers zero slope when y = 5z exactly (confounded), baseline slope 2.5', () => {
    const y = z.map((value) => 5 * value);
    const base = fitBaseline(x, y);
    if ('failure' in base) throw new Error(base.failure);
    expect(base.estimate).toBeCloseTo(2.5, 12);
    const adjusted = fitAdjusted(x, y, z);
    if ('failure' in adjusted) throw new Error(adjusted.failure);
    expect(adjusted.fit.estimate).toBeCloseTo(0, 12);
    expect(adjusted.fit.exact).toBe(true);
    expect(adjusted.fit.df).toBe(1);
  });

  it('uses df = n - 3 and full-model residuals: y = 5z + e gives slope 0, SE 1', () => {
    const y = z.map((value, i) => 5 * value + e[i]);
    const adjusted = fitAdjusted(x, y, z);
    if ('failure' in adjusted) throw new Error(adjusted.failure);
    expect(adjusted.fit.estimate).toBeCloseTo(0, 12);
    expect(adjusted.fit.sse).toBeCloseTo(4, 12);
    expect(adjusted.fit.se).toBeCloseTo(1, 12);
    expect(adjusted.fit.hi).toBeCloseTo(T975_DF1, 8);
    expect(adjusted.residualVarianceRatio).toBeCloseTo(0.5, 12);
  });

  it('rejects a constant covariate and a near-collinear predictor', () => {
    expect(fitAdjusted(x, x, [2, 2, 2, 2])).toMatchObject({ reasonCode: 'constant_covariate' });
    const nearly = z.map((value, i) => value + 1e-6 * w[i]);
    expect(fitAdjusted(nearly, e, z)).toMatchObject({ reasonCode: 'ill_conditioned' });
  });
});
