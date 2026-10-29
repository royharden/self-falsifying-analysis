/**
 * S19 contract types (PLAN.md sections 2-4). One claim, one optional asserted
 * covariate, five fixed recipes, a frozen practical threshold delta.
 */

export const SCHEMA_VERSION = 1;
export const POLICY_ID = 's19-association-v1';
export const POLICY_VERSION = 1;
export const CATALOGUE_VERSION = 1;
export const ENGINE_VERSION = 's19-engine-1.0.0';

/** Canonical order. The ordinal of a kind is its index here and never changes. */
export const RECIPE_KINDS = [
  'baseline_ols',
  'adjusted_ols',
  'influence',
  'rank_sensitivity',
  'predictor_permutation',
] as const;

export type RecipeKind = (typeof RECIPE_KINDS)[number];

export const SECONDARY_KINDS = ['influence', 'rank_sensitivity', 'predictor_permutation'] as const;

export type SecondaryKind = (typeof SECONDARY_KINDS)[number];

export type RecipeRole = 'baseline' | 'primary' | 'secondary';

export type Direction = 'positive' | 'negative';

export type Table = {
  columns: string[];
  rows: number[][];
};

export type HeaderMapEntry = { source: string; id: string };

export const COVARIATE_ROLE = 'asserted_pre_exposure_common_cause';

export type ClaimV1 = {
  statement: string;
  x: string;
  y: string;
  /** null means the user explicitly chose no defensible covariate. */
  z: string | null;
  zRole: typeof COVARIATE_ROLE | null;
  direction: Direction;
  /** Smallest meaningful slope, outcome units per predictor unit, > 0. */
  delta: number;
  xUnits: string;
  yUnits: string;
  iidAcknowledged: true;
};

export type CsvSource = {
  kind: 'csv';
  fileName: string;
  byteLength: number;
  originalHash: string;
  headerMap: HeaderMapEntry[];
};

export type FixtureSource = {
  kind: 'fixture';
  fixtureId: string;
  generatorVersion: string;
  seed: number;
  parameters: Record<string, number>;
};

export type DatasetIdentity = {
  normalizedHash: string;
  rowCount: number;
  columnCount: number;
  source: CsvSource | FixtureSource;
};

export type RecipeParameters = {
  x: string;
  y: string;
  z: string | null;
  direction: Direction;
  delta: number;
  /** predictor_permutation only, otherwise null. */
  permutations: number | null;
  permutationSeed: number | null;
};

export type RecipeV1 = {
  kind: RecipeKind;
  version: 1;
  ordinal: number;
  role: RecipeRole;
  parameters: RecipeParameters;
  inputHash: string;
  engineVersion: string;
  engineSourceDigest: string;
};

export type InfluencePolicy = {
  cookMultiplier: number;
  maxCandidateFraction: number;
  minRetainedRows: number;
};

export type ProtocolV1 = {
  schemaVersion: 1;
  policyId: typeof POLICY_ID;
  policyVersion: 1;
  catalogueVersion: 1;
  engineVersion: string;
  engineSourceDigest: string;
  claim: ClaimV1;
  dataset: DatasetIdentity;
  seed: number;
  permutations: number;
  attemptDeadlineMs: number;
  minResidualVarianceRatio: number;
  influence: InfluencePolicy;
  recipes: RecipeV1[];
  /** Display/execution order of the three secondaries. Baseline and primary always run first. */
  secondaryOrder: SecondaryKind[];
  parentAnalysisId: string | null;
};

export type FitSummary = {
  n: number;
  df: number;
  estimate: number;
  se: number;
  lo: number;
  hi: number;
  tCrit: number;
  sse: number;
  exact: boolean;
  /** Two-sided classical p-value against zero. Descriptive only, never a verdict input. */
  pDescriptive: number;
};

export type IntervalState = 'below' | 'straddle' | 'above';

export type ClaimedInterval = { L: number; U: number; state: IntervalState };

export type BaselinePayload = {
  kind: 'baseline_ols';
  fit: FitSummary;
  claimed: ClaimedInterval;
};

export type AdjustedPayload = {
  kind: 'adjusted_ols';
  covariate: string;
  fit: FitSummary;
  claimed: ClaimedInterval;
  residualVarianceRatio: number;
};

export type InfluencePayload = {
  kind: 'influence';
  nOriginal: number;
  threshold: number;
  maxCookD: number;
  candidates: number[];
  nReduced: number | null;
  reduced: FitSummary | null;
  reducedClaimed: ClaimedInterval | null;
  differenceFromOriginal: number | null;
  reversed: boolean | null;
};

export type RankPayload = {
  kind: 'rank_sensitivity';
  fit: FitSummary;
  reversed: boolean;
  intervalContainsZero: boolean;
};

export type PermutationPayload = {
  kind: 'predictor_permutation';
  permutations: number;
  seed: number;
  observedAbsSlope: number;
  exceedances: number;
  tailProportion: number;
};

export type AttemptPayload = BaselinePayload | AdjustedPayload | InfluencePayload | RankPayload | PermutationPayload;

export const OUTCOME_CLASSES = [
  'baseline_reproduced',
  'baseline_not_reproduced',
  'challenged_primary',
  'retained_primary',
  'inconclusive',
  'sensitivity_flag',
  'no_flag',
  'inapplicable',
  'error',
  'cancelled',
  'interrupted',
] as const;

export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

/** A terminal record for one recipe slot. Failed slots carry a reason, never invented numbers. */
export type TerminalAttempt = {
  ordinal: number;
  kind: RecipeKind;
  role: RecipeRole;
  recipeHash: string;
  outcome: OutcomeClass;
  reasonCode: string;
  reason: string;
  payload: AttemptPayload | null;
  payloadHash: string;
};

export type HeadlineCode =
  | 'integrity_error'
  | 'inconclusive'
  | 'not_reproduced'
  | 'limited_unadjusted'
  | 'challenged'
  | 'not_challenged';

export type CoverageCounts = {
  planned: number;
  completed: number;
  noFlag: number;
  flagged: number;
  inapplicable: number;
  error: number;
  cancelled: number;
  interrupted: number;
  missing: number;
};

export type Headline = {
  code: HeadlineCode;
  title: string;
  reason: string;
  scopeNote: string | null;
  coverage: CoverageCounts;
};

export type FitFailure = { failure: string; reasonCode: string };

export function isFitFailure<T extends object>(value: T | FitFailure): value is FitFailure {
  return 'failure' in value;
}

export function isRecipeKind(value: unknown): value is RecipeKind {
  return typeof value === 'string' && (RECIPE_KINDS as readonly string[]).includes(value);
}

export function isSecondaryKind(value: unknown): value is SecondaryKind {
  return typeof value === 'string' && (SECONDARY_KINDS as readonly string[]).includes(value);
}

export function isDirection(value: unknown): value is Direction {
  return value === 'positive' || value === 'negative';
}

export function roleOf(kind: RecipeKind): RecipeRole {
  if (kind === 'baseline_ols') return 'baseline';
  if (kind === 'adjusted_ols') return 'primary';
  return 'secondary';
}

export function ordinalOf(kind: RecipeKind): number {
  return RECIPE_KINDS.indexOf(kind);
}
