import { describe, expect, it } from 'vitest';
import { partialSlope, simpleSlope } from '../src/lib/falsify/ols';

describe('ols', () => {
  it('matches a hand-computed three-point slope', () => {
    const fit = simpleSlope([1, 2, 2], [1, 2, 3]);
    expect('error' in fit).toBe(false);
    if ('error' in fit) return;
    expect(fit.estimate).toBeCloseTo(0.5, 10);
    expect(fit.intercept).toBeCloseTo(2 / 3, 10);
    expect(fit.standardError).toBeCloseTo(Math.sqrt(1 / 12), 10);
    expect(fit.tStatistic).toBeCloseTo(Math.sqrt(3), 8);
    expect(fit.pValue).toBeCloseTo(1 / 3, 6);
    expect(fit.df).toBe(1);
  });

  it('treats an exact line and a flat outcome as exact fits', () => {
    const line = simpleSlope([2, 4, 6, 8], [1, 2, 3, 4]);
    const flat = simpleSlope([1, 1, 1, 1], [1, 2, 3, 4]);
    expect('error' in line).toBe(false);
    expect('error' in flat).toBe(false);
    if ('error' in line || 'error' in flat) return;
    expect(line.estimate).toBeCloseTo(2, 10);
    expect(line.pValue).toBe(0);
    expect(flat.estimate).toBe(0);
    expect(flat.pValue).toBe(1);
  });

  it('removes a confounder that fully explains the outcome', () => {
    const z = [1, 1, 1, 1, -1, -1, -1, -1];
    const shock = [1, -1, 1, -1, 1, -1, 1, -1];
    const x = z.map((value, index) => value + 0.5 * shock[index]);
    const partial = partialSlope(z, x, z);
    expect('error' in partial).toBe(false);
    if ('error' in partial) return;
    expect(partial.estimate).toBe(0);
    expect(partial.pValue).toBe(1);
    expect(partial.df).toBe(5);
  });

  it('reports a singular control instead of a slope', () => {
    const z = [1, 2, 3, 4, 5, 6, 7, 8];
    const fit = partialSlope(z, z, z);
    expect(fit).toEqual({ error: 'Predictor has no variation.' });
  });
});
