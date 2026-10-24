/**
 * Deterministic text over validated facts. Every number in these strings is read
 * from a ReportFact; React escapes the output. Model text never supplies a number.
 */
import type { FactBook } from './falsify/grounding';
import type { ProtocolV1, TerminalAttempt } from './falsify/types';
import { formatNumber } from './format';

const v = (book: FactBook, ordinal: number, path: string) => formatNumber(book.get(ordinal, path).value);

function fitSentence(book: FactBook, ordinal: number, prefix: string, unit: string): string {
  return `slope ${v(book, ordinal, `${prefix}.estimate`)} ${unit} (SE ${v(book, ordinal, `${prefix}.se`)}), 95% interval [${v(book, ordinal, `${prefix}.lo`)}, ${v(book, ordinal, `${prefix}.hi`)}], n = ${v(book, ordinal, `${prefix}.n`)}, df = ${v(book, ordinal, `${prefix}.df`)}`;
}

export function attemptSentence(attempt: TerminalAttempt, book: FactBook, protocol: ProtocolV1): string {
  const unit = `${protocol.claim.yUnits} per ${protocol.claim.xUnits}`;
  const delta = `δ = ${formatNumber(protocol.claim.delta)} ${unit}`;
  if (!attempt.payload) return `${attempt.outcome.replaceAll('_', ' ')}: ${attempt.reason}`;
  const o = attempt.ordinal;
  switch (attempt.payload.kind) {
    case 'baseline_ols':
      return `Unadjusted ${fitSentence(book, o, 'fit', unit)}. In the claimed direction the interval is [${v(book, o, 'claimed.L')}, ${v(book, o, 'claimed.U')}] against ${delta}.`;
    case 'adjusted_ols':
      return `Adjusted for ${attempt.payload.covariate}: ${fitSentence(book, o, 'fit', unit)}. In the claimed direction the interval is [${v(book, o, 'claimed.L')}, ${v(book, o, 'claimed.U')}] against ${delta}. Residual predictor variance ratio ${v(book, o, 'residualVarianceRatio')}.`;
    case 'influence': {
      const head = `${v(book, o, 'candidates.length')} of ${v(book, o, 'nOriginal')} rows have Cook’s D above ${v(book, o, 'threshold')} (largest ${v(book, o, 'maxCookD')}).`;
      if (!attempt.payload.reduced) return head;
      return `${head} Without them (descriptive, outcome-selected): ${fitSentence(book, o, 'reduced', unit)}; change from the baseline slope ${v(book, o, 'differenceFromOriginal')}.`;
    }
    case 'rank_sensitivity':
      return `Rank-on-rank ${fitSentence(book, o, 'fit', 'rank per rank')}. Different estimand: δ does not apply.${attempt.payload.intervalContainsZero ? ' The working interval contains zero, so the direction is inconclusive.' : ''}`;
    case 'predictor_permutation':
      return `${v(book, o, 'exceedances')} of ${v(book, o, 'permutations')} shuffles gave an absolute slope at least ${v(book, o, 'observedAbsSlope')}; tail proportion ${v(book, o, 'tailProportion')}. Assumes exchangeable rows under no association; it does not address confounding.`;
    default:
      return attempt.reason;
  }
}

/** A missing fact reference is shown as a grounding failure, never as a blank number. */
export function safeAttemptSentence(attempt: TerminalAttempt, book: FactBook, protocol: ProtocolV1): string {
  try {
    return attemptSentence(attempt, book, protocol);
  } catch (error) {
    return `Grounding failure: ${error instanceof Error ? error.message : 'unresolved fact'}`;
  }
}
