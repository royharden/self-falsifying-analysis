import type {
  ClaimedInterval,
  CoverageCounts,
  Direction,
  Headline,
  ProtocolV1,
  TerminalAttempt,
} from './types';
import { RECIPE_KINDS } from './types';

export const LIMITATION_TEXT =
  'Conditional association under the declared model and covariate. Unobserved confounding, asserted causal roles, measurement validity and prior claim selection are not tested. No causal proof or combined error-control guarantee.';

/**
 * Transform [lo, hi] to the claimed direction and compare with delta (PLAN.md 3.2).
 * Touching delta is inconclusive; an interval wholly opposite the claim is "below".
 */
export function claimedInterval(lo: number, hi: number, direction: Direction, delta: number): ClaimedInterval {
  const L = direction === 'positive' ? lo : -hi;
  const U = direction === 'positive' ? hi : -lo;
  const state = U < delta ? 'below' : L > delta ? 'above' : 'straddle';
  return { L, U, state };
}

/** Sign of the claim applied to an estimate: positive means the estimate points the claimed way. */
export function claimedSign(direction: Direction): 1 | -1 {
  return direction === 'positive' ? 1 : -1;
}

export function coverageOf(attempts: readonly TerminalAttempt[]): CoverageCounts {
  const counts: CoverageCounts = {
    planned: RECIPE_KINDS.length,
    completed: 0,
    noFlag: 0,
    flagged: 0,
    inapplicable: 0,
    error: 0,
    cancelled: 0,
    interrupted: 0,
    missing: 0,
  };
  for (let ordinal = 0; ordinal < RECIPE_KINDS.length; ordinal += 1) {
    const attempt = attempts.find((item) => item.ordinal === ordinal);
    if (!attempt) {
      counts.missing += 1;
      continue;
    }
    switch (attempt.outcome) {
      case 'inapplicable':
        counts.inapplicable += 1;
        break;
      case 'error':
        counts.error += 1;
        break;
      case 'cancelled':
        counts.cancelled += 1;
        break;
      case 'interrupted':
        counts.interrupted += 1;
        break;
      case 'no_flag':
        counts.completed += 1;
        counts.noFlag += 1;
        break;
      case 'sensitivity_flag':
        counts.completed += 1;
        counts.flagged += 1;
        break;
      default:
        counts.completed += 1;
    }
  }
  return counts;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}

/**
 * Headline precedence (PLAN.md 3.3). Secondary diagnostics never move the headline.
 * `integrityErrors` comes from the grounding gate; a non-empty list blocks the verdict.
 */
export function headlineFor(
  protocol: ProtocolV1,
  attempts: readonly TerminalAttempt[],
  integrityErrors: readonly string[] = [],
): Headline {
  const coverage = coverageOf(attempts);
  const delta = `δ = ${fmt(protocol.claim.delta)} ${protocol.claim.yUnits} per ${protocol.claim.xUnits}`;
  const make = (code: Headline['code'], title: string, reason: string, scopeNote: string | null = null): Headline => ({
    code,
    title,
    reason,
    scopeNote,
    coverage,
  });

  if (integrityErrors.length > 0) {
    return make('integrity_error', 'Integrity error — no verdict', `The evidence record failed validation: ${integrityErrors[0]}`);
  }
  const baseline = attempts.find((item) => item.ordinal === 0);
  const primary = attempts.find((item) => item.ordinal === 1);
  if (!baseline || baseline.payload?.kind !== 'baseline_ols') {
    const why = baseline ? baseline.reason : 'The baseline did not run.';
    return make('inconclusive', 'Inconclusive', `The baseline could not be assessed. ${why}`);
  }
  const state = baseline.payload.claimed.state;
  if (state === 'below') {
    return make(
      'not_reproduced',
      'Not reproduced at the declared threshold',
      `The baseline 95% interval lies below ${delta}. The primary adjustment is shown but this is not a successful primary challenge.`,
    );
  }
  if (state === 'straddle') {
    return make('inconclusive', 'Inconclusive', `The baseline 95% interval touches or contains ${delta}.`);
  }
  if (protocol.claim.z === null) {
    return make(
      'limited_unadjusted',
      'Limited / inconclusive robustness',
      `The baseline 95% interval lies above ${delta}, but no defensible covariate was declared.`,
      'Unadjusted association assessed; confounding not assessed.',
    );
  }
  if (!primary || primary.payload?.kind !== 'adjusted_ols') {
    const why = primary ? `${primary.outcome}: ${primary.reason}` : 'The primary adjustment has no terminal record.';
    return make('inconclusive', 'Inconclusive', `The baseline lies above ${delta}, but the primary adjustment did not complete (${why}).`);
  }
  const primaryState = primary.payload.claimed.state;
  if (primaryState === 'below') {
    return make(
      'challenged',
      'Challenged at δ by the primary adjustment',
      `The baseline lies above ${delta}; adjusting for ${protocol.claim.z} puts the 95% interval below it.`,
    );
  }
  if (primaryState === 'above') {
    return make(
      'not_challenged',
      'Not challenged by this protocol',
      `Both the baseline and the ${protocol.claim.z}-adjusted 95% intervals lie above ${delta}.`,
    );
  }
  return make(
    'inconclusive',
    'Inconclusive',
    `The baseline lies above ${delta}; the ${protocol.claim.z}-adjusted 95% interval touches or contains it.`,
  );
}
