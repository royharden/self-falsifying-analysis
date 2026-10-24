/**
 * Seeded benchmark under the same policy as the product (PLAN.md 9). Every attempted
 * case stays in its family denominator; failures are counted, never dropped.
 * Synthetic families written with knowledge of the engine do not establish real-world generalization.
 */
import { headlineFor } from './aggregate';
import { canonicalHash } from './canonical';
import { BENCH_DELTA, FAMILIES, GENERATOR_VERSION, generateCase, type CaseSpec, type ColumnMeta, type Family } from './generate';
import { fitBaseline } from './ols';
import { buildProtocol, DEFAULT_SECONDARY_ORDER } from './planSchema';
import { runFull } from './runner';
import { ENGINE_VERSION, POLICY_ID, type HeadlineCode, type OutcomeClass } from './types';

export type SplitName = 'development' | 'heldout';

export type Manifest = {
  manifestVersion: 1;
  generatorVersion: string;
  policyId: string;
  engineVersion: string;
  delta: number;
  permutations: number;
  seedsPerCell: number;
  splits: Record<SplitName, { start: number; count: number }>;
  sizes: number[];
  signs: (1 | -1)[];
  families: Record<Family, { ratios: number[] }>;
  browserCaseCap: number;
  /** Cases per split implied by families x ratios x sizes x signs x seedsPerCell. */
  expectedCasesPerSplit: number;
};

export const DEFAULT_MANIFEST: Manifest = {
  manifestVersion: 1,
  generatorVersion: GENERATOR_VERSION,
  policyId: POLICY_ID,
  engineVersion: ENGINE_VERSION,
  delta: BENCH_DELTA,
  permutations: 199,
  seedsPerCell: 30,
  splits: { development: { start: 0, count: 200 }, heldout: { start: 10000, count: 100 } },
  sizes: [80, 200, 800],
  signs: [1, -1],
  families: {
    real_adjusted: { ratios: [2] },
    real_weak: { ratios: [0.5] },
    real_boundary: { ratios: [1] },
    confounded_observed: { ratios: [0] },
    null: { ratios: [0] },
    outlier_contamination: { ratios: [2] },
    unobserved_confounding: { ratios: [0] },
    stress_heavy_tail: { ratios: [0, 2] },
    stress_near_collinear: { ratios: [0, 2] },
  },
  browserCaseCap: 20,
  expectedCasesPerSplit: 1980,
};

export function validateManifest(manifest: Manifest): string[] {
  const errors: string[] = [];
  if (manifest.manifestVersion !== 1) errors.push('Unknown manifest version.');
  if (manifest.generatorVersion !== GENERATOR_VERSION) errors.push('Manifest generator version differs from this build.');
  if (manifest.engineVersion !== ENGINE_VERSION || manifest.policyId !== POLICY_ID) errors.push('Manifest engine/policy differs from this build.');
  if (manifest.delta !== BENCH_DELTA) errors.push('Manifest δ differs from the generator scale.');
  const dev = manifest.splits.development;
  const held = manifest.splits.heldout;
  if (dev.start + dev.count > held.start && held.start + held.count > dev.start) errors.push('Development and held-out seeds overlap.');
  if (manifest.seedsPerCell > Math.min(dev.count, held.count)) errors.push('seedsPerCell exceeds a split.');
  for (const family of Object.keys(manifest.families)) {
    if (!(FAMILIES as readonly string[]).includes(family)) errors.push(`Unknown family ${family}.`);
  }
  if (errors.length === 0 && expandManifest(manifest, 'development').length !== manifest.expectedCasesPerSplit) {
    errors.push('expectedCasesPerSplit does not match the expanded grid.');
  }
  return errors;
}

export function manifestHash(manifest: Manifest): string {
  return canonicalHash(manifest);
}

/** All cases of a split: family x ratio x n x sign x first seedsPerCell seeds. Paired arms reuse a case. */
export function expandManifest(manifest: Manifest, split: SplitName): CaseSpec[] {
  const { start } = manifest.splits[split];
  const specs: CaseSpec[] = [];
  for (const family of FAMILIES) {
    const entry = manifest.families[family];
    if (!entry) continue;
    for (const ratio of entry.ratios) {
      for (const n of manifest.sizes) {
        for (const sign of manifest.signs) {
          for (let k = 0; k < manifest.seedsPerCell; k += 1) specs.push({ family, seed: start + k, n, ratio, sign });
        }
      }
    }
  }
  return specs;
}

export type NaiveArm =
  | { ok: true; estimate: number; lo: number; hi: number; p: number; support: boolean }
  | { ok: false; reason: string };

export type GuidedArm =
  | {
      ok: true;
      headline: HeadlineCode;
      baselineOutcome: OutcomeClass;
      primaryOutcome: OutcomeClass;
      primaryEstimate: number | null;
      adjustedAbsError: number | null;
      influenceOutcome: OutcomeClass;
      influenceCandidates: number[];
      secondaryCoverageIncomplete: boolean;
    }
  | { ok: false; reason: string };

export type CaseResult = {
  spec: CaseSpec;
  structuralSlope: number;
  contaminatedIndices: number[];
  naive: NaiveArm;
  guided: GuidedArm;
};

/** Arm 1: unadjusted two-sided p < 0.05 with the claimed sign. A different decision rule, labelled as such. */
function naiveArm(x: number[], y: number[], sign: 1 | -1): NaiveArm {
  const fit = fitBaseline(x, y);
  if ('failure' in fit) return { ok: false, reason: fit.failure };
  return { ok: true, estimate: fit.estimate, lo: fit.lo, hi: fit.hi, p: fit.pDescriptive, support: sign * fit.estimate > 0 && fit.pDescriptive < 0.05 };
}

export function evaluateCase(spec: CaseSpec, manifest: Manifest, engineSourceDigest: string): CaseResult {
  let generated;
  try {
    generated = generateCase(spec);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'generation failed';
    return { spec, structuralSlope: Number.NaN, contaminatedIndices: [], naive: { ok: false, reason }, guided: { ok: false, reason } };
  }
  const x = generated.table.rows.map((row) => row[0]);
  const y = generated.table.rows.map((row) => row[1]);
  const naive = naiveArm(x, y, spec.sign);
  let guided: GuidedArm;
  try {
    const built = buildProtocol({
      table: generated.table,
      dataset: generated.dataset,
      claim: {
        statement: `x ${spec.sign === 1 ? 'raises' : 'lowers'} y by at least δ per unit.`,
        x: 'x',
        y: 'y',
        covariate: generated.guidedCovariate ? { kind: 'asserted', column: generated.guidedCovariate, confirmed: true } : { kind: 'none' },
        direction: generated.direction,
        delta: manifest.delta,
        xUnits: 'unit',
        yUnits: 'unit',
        iidAcknowledged: true,
      },
      seed: spec.seed,
      permutations: manifest.permutations,
      secondaryOrder: DEFAULT_SECONDARY_ORDER,
      engineSourceDigest,
      parentAnalysisId: null,
    });
    if (!built.ok) {
      guided = { ok: false, reason: built.errors.join(' ') };
    } else {
      const attempts = runFull(generated.table, built.protocol);
      const headline = headlineFor(built.protocol, attempts);
      const primary = attempts[1];
      const influence = attempts[2];
      const primaryEstimate = primary.payload?.kind === 'adjusted_ols' ? primary.payload.fit.estimate : null;
      guided = {
        ok: true,
        headline: headline.code,
        baselineOutcome: attempts[0].outcome,
        primaryOutcome: primary.outcome,
        primaryEstimate,
        adjustedAbsError: primaryEstimate === null ? null : Math.abs(primaryEstimate - generated.structuralSlope),
        influenceOutcome: influence.outcome,
        influenceCandidates: influence.payload?.kind === 'influence' ? influence.payload.candidates : [],
        secondaryCoverageIncomplete: attempts.slice(2).some((attempt) => ['error', 'inapplicable', 'cancelled', 'interrupted'].includes(attempt.outcome)),
      };
    }
  } catch (error) {
    guided = { ok: false, reason: error instanceof Error ? error.message : 'evaluation failed' };
  }
  return { spec, structuralSlope: generated.structuralSlope, contaminatedIndices: generated.contaminatedIndices, naive, guided };
}

/* ------------------------------------------------------------------ */
/* Summaries. */

export type Rate = { k: number; n: number; rate: number | null; wilson95: [number, number] | null };

/** Wilson score interval, z = 1.959963984540054. */
export function wilson(k: number, n: number): Rate {
  if (n === 0) return { k, n, rate: null, wilson95: null };
  const z = 1.959963984540054;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { k, n, rate: p, wilson95: [Math.max(0, centre - half), Math.min(1, centre + half)] };
}

export type CellSummary = {
  family: Family;
  ratio: number;
  n: number;
  sign: 1 | -1;
  attempted: number;
  guidedFailed: number;
  naiveFailed: number;
  headlines: Partial<Record<HeadlineCode, number>>;
  primaryChallenge: Rate;
  notChallenged: Rate;
  inconclusive: Rate;
  naiveSupport: Rate;
  secondaryCoverageIncomplete: number;
  adjustedAbsError: { count: number; mean: number | null; median: number | null; max: number | null };
  /** outlier_contamination only. */
  influenceDetection: Rate | null;
  /** Pooled over indices that cluster within cases: descriptive, the interval is anti-conservative. */
  influenceIndexCoverage: Rate | null;
};

export type CampaignReport = {
  manifestHash: string;
  split: SplitName;
  generatorVersion: string;
  engineVersion: string;
  policyId: string;
  engineSourceDigest: string;
  attemptedCases: number;
  expectedCases: number;
  cells: CellSummary[];
  plannerArm: 'not executed (mock contract only; a real run needs separate authorization)';
  limitations: string[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarize(
  results: CaseResult[],
  manifest: Manifest,
  split: SplitName,
  engineSourceDigest: string,
  expectedCases: number,
): CampaignReport {
  const cells = new Map<string, CaseResult[]>();
  for (const result of results) {
    const { family, ratio, n, sign } = result.spec;
    const key = `${family}|${ratio}|${n}|${sign}`;
    const list = cells.get(key) ?? [];
    list.push(result);
    cells.set(key, list);
  }
  const summaries: CellSummary[] = [];
  for (const list of cells.values()) {
    const { family, ratio, n, sign } = list[0].spec;
    const attempted = list.length;
    const guided = list.map((item) => item.guided);
    const headlines: Partial<Record<HeadlineCode, number>> = {};
    let challenge = 0;
    let retained = 0;
    let inconclusive = 0;
    let incomplete = 0;
    const errors: number[] = [];
    for (const arm of guided) {
      if (!arm.ok) continue;
      headlines[arm.headline] = (headlines[arm.headline] ?? 0) + 1;
      if (arm.headline === 'challenged') challenge += 1;
      if (arm.headline === 'not_challenged') retained += 1;
      if (arm.headline === 'inconclusive' || arm.headline === 'limited_unadjusted') inconclusive += 1;
      if (arm.secondaryCoverageIncomplete) incomplete += 1;
      if (arm.adjustedAbsError !== null) errors.push(arm.adjustedAbsError);
    }
    let detection: Rate | null = null;
    let coverage: Rate | null = null;
    if (family === 'outlier_contamination') {
      let detected = 0;
      let flaggedIndices = 0;
      let totalIndices = 0;
      for (const item of list) {
        const candidates = item.guided.ok ? new Set(item.guided.influenceCandidates) : new Set<number>();
        const hits = item.contaminatedIndices.filter((index) => candidates.has(index)).length;
        if (hits > 0) detected += 1;
        flaggedIndices += hits;
        totalIndices += item.contaminatedIndices.length;
      }
      detection = wilson(detected, attempted);
      coverage = wilson(flaggedIndices, totalIndices);
    }
    // All rates use the attempted denominator: failed cases count against every rate.
    summaries.push({
      family,
      ratio,
      n,
      sign,
      attempted,
      guidedFailed: guided.filter((arm) => !arm.ok).length,
      naiveFailed: list.filter((item) => !item.naive.ok).length,
      headlines,
      primaryChallenge: wilson(challenge, attempted),
      notChallenged: wilson(retained, attempted),
      inconclusive: wilson(inconclusive, attempted),
      naiveSupport: wilson(list.filter((item) => item.naive.ok && item.naive.support).length, attempted),
      secondaryCoverageIncomplete: incomplete,
      adjustedAbsError: {
        count: errors.length,
        mean: errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null,
        median: median(errors),
        max: errors.length ? Math.max(...errors) : null,
      },
      influenceDetection: detection,
      influenceIndexCoverage: coverage,
    });
  }
  return {
    manifestHash: manifestHash(manifest),
    split,
    generatorVersion: manifest.generatorVersion,
    engineVersion: manifest.engineVersion,
    policyId: manifest.policyId,
    engineSourceDigest,
    attemptedCases: results.length,
    expectedCases,
    cells: summaries,
    plannerArm: 'not executed (mock contract only; a real run needs separate authorization)',
    limitations: [
      'Synthetic generators written with knowledge of the engine; no real-world generalization is established.',
      'The guided arm is oracle-assisted: the scenario declares the covariate.',
      'Heavy-tail and near-collinear rows are out-of-assumption stress rows; classical coverage is not established there.',
      'At β < δ a challenge or non-reproduction does not deny a smaller nonzero effect.',
      'The naive arm uses a different decision rule (two-sided p < 0.05 with the claimed sign) and is not comparable to retention above δ.',
      'Planted-index coverage pools indices that cluster within cases; its interval is descriptive and anti-conservative.',
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Planner-proposal scoring (arm 3). Mock-tested only; no paid call is made here. */

export type ProposalScore =
  | 'correct_control'
  | 'decoy_selected'
  | 'post_exposure_selected'
  | 'other_wrong_control'
  | 'abstained_valid_available'
  | 'abstained_none_valid'
  | 'selected_without_role_info'
  | 'abstained_no_role_info'
  | 'invalid_proposal';

/**
 * Scores a planner proposal against controlled role metadata. With name-only
 * anonymized inputs (no role information) no control is reliably identifiable:
 * a selection is never credited as correct and an abstention is not a miss.
 */
export function scoreProposal(proposal: { covariate: string | null } | null, columns: ColumnMeta[], x: string, y: string, roleInfoGiven: boolean): ProposalScore {
  if (proposal === null) return 'invalid_proposal';
  if (proposal.covariate !== null && (proposal.covariate === x || proposal.covariate === y || !columns.some((item) => item.id === proposal.covariate))) {
    return 'invalid_proposal';
  }
  if (!roleInfoGiven) return proposal.covariate === null ? 'abstained_no_role_info' : 'selected_without_role_info';
  const valid = columns.filter((column) => column.role === 'pre_exposure_common_cause').map((column) => column.id);
  if (proposal.covariate === null) return valid.length > 0 ? 'abstained_valid_available' : 'abstained_none_valid';
  const column = columns.find((item) => item.id === proposal.covariate);
  if (!column) return 'invalid_proposal';
  if (valid.includes(column.id)) return 'correct_control';
  if (column.role === 'independent_decoy') return 'decoy_selected';
  if (column.role === 'post_exposure') return 'post_exposure_selected';
  return 'other_wrong_control';
}

/* ------------------------------------------------------------------ */

function pct(rate: Rate): string {
  if (rate.rate === null || !rate.wilson95) return 'n/a';
  return `${(rate.rate * 100).toFixed(1)}% [${(rate.wilson95[0] * 100).toFixed(1)}, ${(rate.wilson95[1] * 100).toFixed(1)}] (${rate.k}/${rate.n})`;
}

export function renderMarkdown(report: CampaignReport, invocation: string, revision: string): string {
  const lines = [
    `# S19 benchmark results — ${report.split}`,
    '',
    `- Invocation: \`${invocation}\``,
    `- Source revision: ${revision}`,
    `- Manifest hash: \`${report.manifestHash}\``,
    `- Engine ${report.engineVersion}, policy ${report.policyId}, kernel digest \`${report.engineSourceDigest}\``,
    `- Generator: ${report.generatorVersion}`,
    `- Cases attempted: ${report.attemptedCases} of ${report.expectedCases} expected`,
    `- Planner arm: ${report.plannerArm}`,
    '',
    'Rates use every attempted case as the denominator, with Wilson 95% intervals. Headline counts are the full distribution.',
    '',
    '| family | β/δ | n | sign | attempted | failed | challenged | not challenged | inconclusive/limited | naive support | |adj − β| median | headline distribution |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const cell of report.cells) {
    lines.push(
      `| ${cell.family} | ${cell.ratio} | ${cell.n} | ${cell.sign} | ${cell.attempted} | ${cell.guidedFailed} | ${pct(cell.primaryChallenge)} | ${pct(cell.notChallenged)} | ${pct(cell.inconclusive)} | ${pct(cell.naiveSupport)} | ${cell.adjustedAbsError.median === null ? 'n/a' : cell.adjustedAbsError.median.toFixed(4)} | ${Object.entries(cell.headlines).map(([code, count]) => `${code}: ${count}`).join(', ')} |`,
    );
  }
  const outliers = report.cells.filter((cell) => cell.influenceDetection);
  if (outliers.length > 0) {
    lines.push('', '## Influence diagnostic on contaminated cases (scored separately from the headline)', '', '| n | sign | detection (any planted index flagged) | planted-index coverage (descriptive) |', '|---|---|---|---|');
    for (const cell of outliers) {
      lines.push(`| ${cell.n} | ${cell.sign} | ${pct(cell.influenceDetection as Rate)} | ${pct(cell.influenceIndexCoverage as Rate)} |`);
    }
  }
  lines.push('', '## Limitations', '', ...report.limitations.map((item) => `- ${item}`), '');
  return lines.join('\n');
}
