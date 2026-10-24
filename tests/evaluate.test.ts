import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANIFEST,
  evaluateCase,
  expandManifest,
  scoreProposal,
  summarize,
  validateManifest,
  wilson,
  type CaseResult,
} from '../src/lib/falsify/evaluate';
import { BENCH_DELTA, generateCase, type ColumnMeta } from '../src/lib/falsify/generate';
import { fitAdjusted } from '../src/lib/falsify/ols';
import { buildProtocol, DEFAULT_SECONDARY_ORDER } from '../src/lib/falsify/planSchema';
import { runFull } from '../src/lib/falsify/runner';
import type { FixtureSource, HeadlineCode } from '../src/lib/falsify/types';

const DIGEST = 'a'.repeat(64);

describe('manifest and splits', () => {
  it('is valid and keeps development and held-out seeds disjoint', () => {
    expect(validateManifest(DEFAULT_MANIFEST)).toEqual([]);
    const dev = new Set(expandManifest(DEFAULT_MANIFEST, 'development').map((spec) => spec.seed));
    const held = expandManifest(DEFAULT_MANIFEST, 'heldout').map((spec) => spec.seed);
    expect(held.some((seed) => dev.has(seed))).toBe(false);
  });

  it('expands family x ratio x n x sign x 30 seeds', () => {
    const ratios = Object.values(DEFAULT_MANIFEST.families).reduce((sum, family) => sum + family.ratios.length, 0);
    expect(expandManifest(DEFAULT_MANIFEST, 'development')).toHaveLength(ratios * 3 * 2 * 30);
  });

  it('rejects overlapping splits', () => {
    const bad = { ...DEFAULT_MANIFEST, splits: { development: { start: 0, count: 200 }, heldout: { start: 150, count: 100 } } };
    expect(validateManifest(bad).length).toBeGreaterThan(0);
  });
});

describe('generators', () => {
  it('is deterministic per seed and keeps truth out of the table', () => {
    const spec = { family: 'confounded_observed' as const, seed: 3, n: 200, ratio: 0, sign: 1 as const };
    const a = generateCase(spec);
    const b = generateCase(spec);
    expect(a.table).toEqual(b.table);
    expect(a.table.columns).toEqual(['x', 'y', 'z', 'decoy', 'post']);
    expect(a.structuralSlope).toBe(0);
  });

  it('hides z in the unobserved-confounding family and offers no guided covariate', () => {
    const generated = generateCase({ family: 'unobserved_confounding', seed: 1, n: 80, ratio: 0, sign: 1 });
    expect(generated.table.columns).not.toContain('z');
    expect(generated.guidedCovariate).toBeNull();
  });

  it('contaminates exactly floor(2% n) recorded indices', () => {
    const generated = generateCase({ family: 'outlier_contamination', seed: 5, n: 200, ratio: 2, sign: 1 });
    expect(generated.contaminatedIndices).toHaveLength(4);
  });

  it('recovers the structural slope at large n (generator sanity, not an accuracy claim)', () => {
    const generated = generateCase({ family: 'real_adjusted', seed: 7, n: 800, ratio: 2, sign: -1 });
    const col = (i: number) => generated.table.rows.map((row) => row[i]);
    const fit = fitAdjusted(col(0), col(1), col(2));
    if ('failure' in fit) throw new Error(fit.failure);
    expect(Math.abs(fit.fit.estimate - -2 * BENCH_DELTA)).toBeLessThan(0.2);
  });
});

describe('evaluation and scoring', () => {
  it('evaluates paired arms on the same case deterministically', () => {
    const spec = { family: 'null' as const, seed: 0, n: 80, ratio: 0, sign: 1 as const };
    expect(evaluateCase(spec, DEFAULT_MANIFEST, DIGEST)).toEqual(evaluateCase(spec, DEFAULT_MANIFEST, DIGEST));
  });

  it('keeps failed cases in every denominator', () => {
    const spec = { family: 'null' as const, seed: 0, n: 80, ratio: 0, sign: 1 as const };
    const ok = evaluateCase(spec, DEFAULT_MANIFEST, DIGEST);
    const failed: CaseResult = { spec, structuralSlope: 0, contaminatedIndices: [], naive: { ok: false, reason: 'x' }, guided: { ok: false, reason: 'x' } };
    const report = summarize([ok, failed], DEFAULT_MANIFEST, 'development', DIGEST, 2);
    expect(report.cells).toHaveLength(1);
    expect(report.cells[0].attempted).toBe(2);
    expect(report.cells[0].guidedFailed).toBe(1);
    expect(report.cells[0].notChallenged.n).toBe(2);
  });

  it('computes Wilson intervals', () => {
    const zero = wilson(0, 10);
    expect(zero.wilson95?.[0]).toBe(0);
    expect(zero.wilson95?.[1]).toBeCloseTo(3.841458820694124 / (10 + 3.841458820694124), 10);
    expect(wilson(0, 0).rate).toBeNull();
  });

  it('scores planner proposals against role metadata', () => {
    const columns: ColumnMeta[] = [
      { id: 'x', label: 'x', role: 'predictor', units: 'u' },
      { id: 'y', label: 'y', role: 'outcome', units: 'u' },
      { id: 'z', label: 'z', role: 'pre_exposure_common_cause', units: 'u' },
      { id: 'decoy', label: 'decoy', role: 'independent_decoy', units: 'u' },
      { id: 'post', label: 'post', role: 'post_exposure', units: 'u' },
    ];
    expect(scoreProposal({ covariate: 'z' }, columns, 'x', 'y', true)).toBe('correct_control');
    expect(scoreProposal({ covariate: 'decoy' }, columns, 'x', 'y', true)).toBe('decoy_selected');
    expect(scoreProposal({ covariate: 'post' }, columns, 'x', 'y', true)).toBe('post_exposure_selected');
    expect(scoreProposal({ covariate: null }, columns, 'x', 'y', true)).toBe('abstained_valid_available');
    expect(scoreProposal({ covariate: null }, columns.filter((c) => c.id !== 'z'), 'x', 'y', true)).toBe('abstained_none_valid');
    // Name-only anonymized inputs: nothing is reliably identifiable, so a selection is never credited.
    expect(scoreProposal({ covariate: 'z' }, columns, 'x', 'y', false)).toBe('selected_without_role_info');
    expect(scoreProposal({ covariate: null }, columns, 'x', 'y', false)).toBe('abstained_no_role_info');
    expect(scoreProposal({ covariate: 'y' }, columns, 'x', 'y', true)).toBe('invalid_proposal');
    expect(scoreProposal(null, columns, 'x', 'y', true)).toBe('invalid_proposal');
  });
});

/** Hand-built results so scorer rules are checked without relying on generator luck. */
function mock(
  family: CaseResult['spec']['family'],
  headline: HeadlineCode,
  extra: { primaryEstimate?: number | null; structural?: number; naiveSupport?: boolean; candidates?: number[]; contaminated?: number[]; sign?: 1 | -1 } = {},
): CaseResult {
  const structural = extra.structural ?? 0;
  const primaryEstimate = extra.primaryEstimate === undefined ? 0 : extra.primaryEstimate;
  return {
    spec: { family, seed: 0, n: 200, ratio: 0, sign: extra.sign ?? 1 },
    structuralSlope: structural,
    contaminatedIndices: extra.contaminated ?? [],
    naive: { ok: true, estimate: 1, lo: 0.5, hi: 1.5, p: 0.01, support: extra.naiveSupport ?? true },
    guided: {
      ok: true,
      headline,
      baselineOutcome: 'baseline_reproduced',
      primaryOutcome: 'challenged_primary',
      primaryEstimate,
      adjustedAbsError: primaryEstimate === null ? null : Math.abs(primaryEstimate - structural),
      influenceOutcome: 'no_flag',
      influenceCandidates: extra.candidates ?? [],
      secondaryCoverageIncomplete: false,
    },
  };
}

describe('scorer rules on deterministic mock cases', () => {
  const cell = (results: CaseResult[]) => summarize(results, DEFAULT_MANIFEST, 'development', DIGEST, results.length).cells[0];

  it('counts only a challenged headline as a primary challenge', () => {
    const summary = cell([
      mock('confounded_observed', 'challenged'),
      mock('confounded_observed', 'not_reproduced'),
      mock('confounded_observed', 'limited_unadjusted'),
      mock('confounded_observed', 'inconclusive'),
    ]);
    expect(summary.primaryChallenge.k).toBe(1);
    expect(summary.notChallenged.k).toBe(0);
    expect(summary.inconclusive.k).toBe(2);
    expect(summary.headlines).toEqual({ challenged: 1, not_reproduced: 1, limited_unadjusted: 1, inconclusive: 1 });
  });

  it('never scores unadjusted-scope cases as not challenged', () => {
    const summary = cell([mock('unobserved_confounding', 'limited_unadjusted', { primaryEstimate: null })]);
    expect(summary.notChallenged.k).toBe(0);
    expect(summary.inconclusive.k).toBe(1);
    expect(summary.adjustedAbsError.count).toBe(0);
  });

  it('measures adjusted error against the signed structural slope, including beta = 0', () => {
    const summary = cell([
      mock('real_adjusted', 'not_challenged', { primaryEstimate: -0.35, structural: -0.4, sign: -1 }),
    ]);
    expect(summary.adjustedAbsError.median).toBeCloseTo(0.05, 12);
    expect(cell([mock('confounded_observed', 'challenged', { primaryEstimate: 0.03 })]).adjustedAbsError.max).toBeCloseTo(0.03, 12);
  });

  it('keeps naive support separate from retention', () => {
    const summary = cell([mock('null', 'not_reproduced', { naiveSupport: true })]);
    expect(summary.naiveSupport.k).toBe(1);
    expect(summary.notChallenged.k).toBe(0);
  });

  it('scores influence detection and index coverage separately from the headline', () => {
    const summary = cell([
      mock('outlier_contamination', 'not_challenged', { contaminated: [3, 9, 20, 40], candidates: [3, 9, 77] }),
      mock('outlier_contamination', 'challenged', { contaminated: [1, 2, 5, 8], candidates: [] }),
    ]);
    expect(summary.influenceDetection?.k).toBe(1);
    expect(summary.influenceDetection?.n).toBe(2);
    expect(summary.influenceIndexCoverage?.k).toBe(2);
    expect(summary.influenceIndexCoverage?.n).toBe(8);
    expect(summary.primaryChallenge.k).toBe(1);
  });
});

describe('no truth leakage into the analysis', () => {
  it('gives identical outcomes and payloads when only the provenance truth labels differ', () => {
    const generated = generateCase({ family: 'confounded_observed', seed: 4, n: 80, ratio: 0, sign: 1 });
    const runWith = (parameters: Record<string, number>, fixtureId: string) => {
      const dataset = { ...generated.dataset, source: { ...(generated.dataset.source as FixtureSource), fixtureId, parameters } };
      const built = buildProtocol({
        table: generated.table,
        dataset,
        claim: {
          statement: 'x raises y.',
          x: 'x',
          y: 'y',
          covariate: { kind: 'asserted', column: 'z', confirmed: true },
          direction: 'positive',
          delta: BENCH_DELTA,
          xUnits: 'unit',
          yUnits: 'unit',
          iidAcknowledged: true,
        },
        seed: 4,
        permutations: 199,
        secondaryOrder: DEFAULT_SECONDARY_ORDER,
        engineSourceDigest: DIGEST,
        parentAnalysisId: null,
      });
      if (!built.ok) throw new Error(built.errors.join('; '));
      return runFull(generated.table, built.protocol).map((attempt) => ({ outcome: attempt.outcome, payload: attempt.payload }));
    };
    expect(runWith({ beta: 0, ratio: 0 }, 'bench_confounded_observed')).toEqual(runWith({ beta: 9, ratio: 45 }, 'bench_real_adjusted'));
  });
});
