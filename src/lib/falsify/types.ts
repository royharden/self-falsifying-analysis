export const ATTACK_KINDS = [
  'naive',
  'placebo_shuffle',
  'subset_stability',
  'confounder_control',
  'alternative_spec',
] as const;

export type AttackKind = (typeof ATTACK_KINDS)[number];

export type Direction = 'positive' | 'negative' | 'nonzero';

export type Verdict = 'survived' | 'falsified' | 'unsupported';

export type PlannerName = 'deterministic' | 'llm';

export type Table = {
  columns: string[];
  rows: number[][];
};

export type ClaimSpec = {
  statement: string;
  outcome: string;
  predictor: string;
  direction: Direction;
  confounder: string | null;
};

export type AttackProgram = {
  kind: AttackKind;
  seed: number;
  predictor: string;
  outcome: string;
  direction: Direction;
  alpha: number;
  placeboReplicates: number;
  subsetFolds: number;
  confounder: string | null;
  spec: 'rank';
};

export type FrozenPlan = {
  planner: PlannerName;
  seed: number;
  alpha: number;
  placeboReplicates: number;
  rationale: string | null;
  programs: AttackProgram[];
};

export type AttemptDetails = Record<string, number | string | boolean | null>;

export type AttemptResult = {
  ordinal: number;
  kind: AttackKind;
  program: AttackProgram;
  sourceText: string;
  estimate: number | null;
  standardError: number | null;
  pValue: number | null;
  n: number;
  degreesOfFreedom: number | null;
  supportsClaim: boolean;
  undermines: boolean;
  reason: string;
  details: AttemptDetails;
  error: string | null;
};

export type AdjustedP = {
  kind: AttackKind;
  ordinal: number;
  p: number;
  adjusted: number;
};

export type AnalysisRun = {
  plan: FrozenPlan;
  attempts: AttemptResult[];
  verdict: Verdict;
  fisherP: number | null;
  adjusted: AdjustedP[];
  eProduct: number | null;
  eProductCapped: boolean;
  summary: string;
};

export type Fit = {
  estimate: number;
  intercept: number;
  standardError: number;
  tStatistic: number;
  pValue: number;
  n: number;
  df: number;
  rSquared: number;
};

export type FitError = { error: string };

export function isFitError(value: Fit | FitError): value is FitError {
  return 'error' in value;
}

export function isAttackKind(value: string): value is AttackKind {
  return (ATTACK_KINDS as readonly string[]).includes(value);
}

export function isDirection(value: string): value is Direction {
  return value === 'positive' || value === 'negative' || value === 'nonzero';
}
