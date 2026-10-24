import { describe, expect, it } from 'vitest';
import { averageRanks, compensatedSum, studentTCdf, studentTQuantile, studentTTwoSidedP } from '../src/lib/falsify/stats';

// Reference values are closed forms or published t tables, independent of this implementation.
describe('Student t', () => {
  it('matches the Cauchy closed form at df = 1', () => {
    expect(studentTCdf(1, 1)).toBeCloseTo(0.75, 12);
    expect(studentTTwoSidedP(Math.sqrt(3), 1)).toBeCloseTo(1 / 3, 12);
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(Math.tan(Math.PI * 0.475), 9);
  });

  it('matches the df = 2 closed form F(t) = 1/2 + t / (2 sqrt(2 + t^2))', () => {
    for (const t of [0.3, 1, 2.5]) expect(studentTCdf(t, 2)).toBeCloseTo(0.5 + t / (2 * Math.sqrt(2 + t * t)), 12);
    expect(studentTQuantile(0.975, 2)).toBeCloseTo(4.302652729749, 9);
  });

  it('matches published 97.5% quantiles', () => {
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.228138851986, 9);
    expect(studentTQuantile(0.975, 30)).toBeCloseTo(2.042272456301, 9);
    expect(studentTQuantile(0.975, 1000)).toBeCloseTo(1.9623390808, 7);
  });

  it('is symmetric and rejects invalid df', () => {
    expect(studentTCdf(-1.3, 7) + studentTCdf(1.3, 7)).toBeCloseTo(1, 14);
    expect(Number.isNaN(studentTQuantile(0.975, 0))).toBe(true);
  });
});

describe('helpers', () => {
  it('gives tied values the mean of their ranks', () => {
    expect(averageRanks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  it('compensates cancellation', () => {
    expect(compensatedSum([1e16, 1, -1e16])).toBe(1);
  });
});
