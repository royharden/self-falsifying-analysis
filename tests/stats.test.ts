import { describe, expect, it } from 'vitest';
import { averageRanks, benjaminiHochberg, fisherCombinedP, logGamma, studentTTwoSidedP } from '../src/lib/falsify/stats';

describe('stats', () => {
  it('matches gamma at small integers', () => {
    expect(logGamma(1)).toBeCloseTo(0, 8);
    expect(logGamma(2)).toBeCloseTo(0, 8);
    expect(logGamma(3)).toBeCloseTo(Math.log(2), 8);
  });

  it('gives the Cauchy two-sided tail', () => {
    expect(studentTTwoSidedP(Math.sqrt(3), 1)).toBeCloseTo(1 / 3, 6);
    expect(studentTTwoSidedP(0, 10)).toBe(1);
  });

  it('leaves a single Fisher input unchanged', () => {
    expect(fisherCombinedP([0.05])).toBeCloseTo(0.05, 10);
    expect(fisherCombinedP([])).toBeNull();
  });

  it('adjusts three p-values with Benjamini-Hochberg', () => {
    const adjusted = benjaminiHochberg([0.01, 0.04, 0.2]);
    expect(adjusted[0]).toBeCloseTo(0.03, 10);
    expect(adjusted[1]).toBeCloseTo(0.06, 10);
    expect(adjusted[2]).toBeCloseTo(0.2, 10);
  });

  it('averages tied ranks', () => {
    expect(averageRanks([10, 10, 30])).toEqual([1.5, 1.5, 3]);
  });
});
