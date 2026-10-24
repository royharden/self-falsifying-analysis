import { benjaminiHochberg, eProduct, fisherCombinedP } from './stats';
import type { AdjustedP, AnalysisRun, AttemptResult, Verdict } from './types';

export function judge(attempts: readonly AttemptResult[]): Verdict {
  const naive = attempts.find((attempt) => attempt.kind === 'naive' && !attempt.error);
  if (!naive || !naive.supportsClaim) return 'unsupported';
  const overturned = attempts.some((attempt) => attempt.kind !== 'naive' && attempt.undermines);
  return overturned ? 'falsified' : 'survived';
}

export function summarize(verdict: Verdict, attempts: readonly AttemptResult[]): string {
  if (verdict === 'unsupported') {
    return 'The naive association does not show the claimed effect in this table, so the robustness attacks have nothing established to overturn.';
  }
  if (verdict === 'falsified') {
    const names = attempts.filter((attempt) => attempt.undermines).map((attempt) => attempt.kind);
    return `The naive association matches the claim, and these attacks overturn it: ${names.join(', ')}.`;
  }
  const skipped = attempts.filter((attempt) => attempt.error).map((attempt) => attempt.kind);
  const base = 'The naive association matches the claim, and none of the completed robustness attacks overturn it.';
  if (skipped.length === 0) return base;
  return `${base} Could not run: ${skipped.join(', ')}.`;
}

export function aggregateAttempts(
  attempts: AttemptResult[],
): Pick<AnalysisRun, 'verdict' | 'fisherP' | 'adjusted' | 'eProduct' | 'eProductCapped' | 'summary'> {
  const verdict = judge(attempts);
  const robustness = attempts.filter(
    (attempt) => attempt.kind !== 'naive' && attempt.pValue !== null && !attempt.error,
  );
  const pValues = robustness.map((attempt) => attempt.pValue as number);
  const fisherP = fisherCombinedP(pValues);
  const adjustedValues = pValues.length > 0 ? benjaminiHochberg(pValues) : [];
  const adjusted: AdjustedP[] = robustness.map((attempt, index) => ({
    kind: attempt.kind,
    ordinal: attempt.ordinal,
    p: attempt.pValue as number,
    adjusted: adjustedValues[index],
  }));
  const evidence = eProduct(pValues);
  return {
    verdict,
    fisherP,
    adjusted,
    eProduct: evidence ? evidence.product : null,
    eProductCapped: evidence ? evidence.capped : false,
    summary: summarize(verdict, attempts),
  };
}
