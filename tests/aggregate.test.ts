import { describe, expect, it } from 'vitest';
import { claimedInterval, headlineFor } from '../src/lib/falsify/aggregate';
import { workshopFixture } from '../src/lib/falsify/generate';
import { buildProtocol, DEFAULT_SECONDARY_ORDER } from '../src/lib/falsify/planSchema';
import type { ClaimedInterval, FitSummary, ProtocolV1, TerminalAttempt } from '../src/lib/falsify/types';
import { RECIPE_KINDS, roleOf } from '../src/lib/falsify/types';

const DIGEST = 'a'.repeat(64);

function protocol(withCovariate: boolean): ProtocolV1 {
  const fixture = workshopFixture('confounded');
  const built = buildProtocol({
    table: fixture.table,
    dataset: fixture.dataset,
    claim: {
      statement: fixture.suggestion.statement,
      x: 'hours',
      y: 'final_score',
      covariate: withCovariate ? { kind: 'asserted', column: 'prior_score', confirmed: true } : { kind: 'none' },
      direction: 'positive',
      delta: 0.5,
      xUnits: 'hours',
      yUnits: 'points',
      iidAcknowledged: true,
    },
    seed: 1,
    permutations: 199,
    secondaryOrder: DEFAULT_SECONDARY_ORDER,
    engineSourceDigest: DIGEST,
    parentAnalysisId: null,
  });
  if (!built.ok) throw new Error(built.errors.join('; '));
  return built.protocol;
}

const fit = (lo: number, hi: number): FitSummary => ({
  n: 200,
  df: 198,
  estimate: (lo + hi) / 2,
  se: 0.1,
  lo,
  hi,
  tCrit: 1.97,
  sse: 1,
  exact: false,
  pDescriptive: 0.01,
});

function attempt(ordinal: number, partial: Partial<TerminalAttempt>): TerminalAttempt {
  return {
    ordinal,
    kind: RECIPE_KINDS[ordinal],
    role: roleOf(RECIPE_KINDS[ordinal]),
    recipeHash: 'b'.repeat(64),
    outcome: 'no_flag',
    reasonCode: 'x',
    reason: 'r',
    payload: null,
    payloadHash: 'c'.repeat(64),
    ...partial,
  };
}

const base = (claimed: ClaimedInterval) =>
  attempt(0, { outcome: 'baseline_reproduced', payload: { kind: 'baseline_ols', fit: fit(claimed.L, claimed.U), claimed } });
const primary = (claimed: ClaimedInterval) =>
  attempt(1, {
    outcome: 'challenged_primary',
    payload: { kind: 'adjusted_ols', covariate: 'prior_score', fit: fit(claimed.L, claimed.U), claimed, residualVarianceRatio: 0.2 },
  });
const flaggedSecondaries = [2, 3, 4].map((ordinal) => attempt(ordinal, { outcome: 'sensitivity_flag' }));

describe('claimed-direction interval versus delta', () => {
  it('treats touching delta as inconclusive', () => {
    expect(claimedInterval(0.5, 1, 'positive', 0.5).state).toBe('straddle');
    expect(claimedInterval(0.2, 0.5, 'positive', 0.5).state).toBe('straddle');
  });
  it('flips negative claims and treats an opposite interval as below', () => {
    expect(claimedInterval(-1, -0.6, 'negative', 0.5)).toEqual({ L: 0.6, U: 1, state: 'above' });
    expect(claimedInterval(-2, -1, 'positive', 0.5).state).toBe('below');
    expect(claimedInterval(1, 2, 'negative', 0.5).state).toBe('below');
  });
});

describe('headline precedence', () => {
  const above = claimedInterval(1, 2, 'positive', 0.5);
  const below = claimedInterval(-0.1, 0.1, 'positive', 0.5);
  const straddle = claimedInterval(0.3, 0.9, 'positive', 0.5);

  it('integrity errors block the verdict', () => {
    expect(headlineFor(protocol(true), [base(above), primary(below)], ['tampered']).code).toBe('integrity_error');
  });
  it('baseline below delta is not reproduced, not a primary challenge', () => {
    expect(headlineFor(protocol(true), [base(below), primary(below)]).code).toBe('not_reproduced');
  });
  it('baseline straddling delta is inconclusive', () => {
    expect(headlineFor(protocol(true), [base(straddle), primary(below)]).code).toBe('inconclusive');
  });
  it('no covariate gives limited unadjusted scope, never not-challenged', () => {
    const headline = headlineFor(protocol(false), [base(above), attempt(1, { outcome: 'inapplicable' })]);
    expect(headline.code).toBe('limited_unadjusted');
    expect(headline.scopeNote).toBe('Unadjusted association assessed; confounding not assessed.');
  });
  it('failed, cancelled, interrupted or inapplicable primary is inconclusive', () => {
    for (const outcome of ['error', 'cancelled', 'interrupted', 'inapplicable'] as const) {
      expect(headlineFor(protocol(true), [base(above), attempt(1, { outcome })]).code).toBe('inconclusive');
    }
    expect(headlineFor(protocol(true), [base(above)]).code).toBe('inconclusive');
  });
  it('primary below delta challenges; above is not challenged; straddle is inconclusive', () => {
    expect(headlineFor(protocol(true), [base(above), primary(below)]).code).toBe('challenged');
    expect(headlineFor(protocol(true), [base(above), primary(above)]).code).toBe('not_challenged');
    expect(headlineFor(protocol(true), [base(above), primary(straddle)]).code).toBe('inconclusive');
  });
  it('secondary flags never move the headline but show in coverage', () => {
    const headline = headlineFor(protocol(true), [base(above), primary(above), ...flaggedSecondaries]);
    expect(headline.code).toBe('not_challenged');
    expect(headline.coverage.flagged).toBe(3);
    expect(headline.coverage.missing).toBe(0);
  });
});
