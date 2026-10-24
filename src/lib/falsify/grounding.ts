/**
 * GroundingGate, ReportFacts and replay comparison (PLAN.md 4.3).
 * Internal consistency here does not prove mathematical correctness or honest authorship.
 */
import { claimedInterval } from './aggregate';
import { terminalHash } from './attacks';
import { expectedOrdinals, type ExecutionRecord } from './bundle';
import { HASH_PATTERN } from './canonical';
import { recipeHash } from './planSchema';
import type {
  AttemptPayload,
  ClaimedInterval,
  FitSummary,
  OutcomeClass,
  ProtocolV1,
  TerminalAttempt,
} from './types';
import { OUTCOME_CLASSES, RECIPE_KINDS, roleOf } from './types';

export type ReportFactV1 = {
  factId: string;
  executionId: string;
  attemptOrdinal: number;
  metricPath: string;
  value: number;
  unit: string;
  ruleId: string;
  inputHash: string;
  recipeHash: string;
};

const NON_RESULT: readonly OutcomeClass[] = ['inapplicable', 'error', 'cancelled', 'interrupted'];

const ALLOWED: Record<(typeof RECIPE_KINDS)[number], readonly OutcomeClass[]> = {
  baseline_ols: ['baseline_reproduced', 'baseline_not_reproduced', 'inconclusive', ...NON_RESULT],
  adjusted_ols: ['challenged_primary', 'retained_primary', 'inconclusive', ...NON_RESULT],
  influence: ['sensitivity_flag', 'no_flag', ...NON_RESULT],
  rank_sensitivity: ['sensitivity_flag', 'no_flag', ...NON_RESULT],
  predictor_permutation: ['no_flag', ...NON_RESULT],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keysExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const FIT_KEYS = ['n', 'df', 'estimate', 'se', 'lo', 'hi', 'tCrit', 'sse', 'exact', 'pDescriptive'] as const;

function checkFit(value: unknown, path: string, errors: string[], expectedDfOffset: number | null, expectedN: number | null): value is FitSummary {
  if (!isObject(value) || !keysExactly(value, FIT_KEYS)) {
    errors.push(`${path} has the wrong shape.`);
    return false;
  }
  for (const key of FIT_KEYS) {
    if (key === 'exact') continue;
    if (!isFiniteNumber(value[key])) errors.push(`${path}.${key} is not finite.`);
  }
  if (typeof value.exact !== 'boolean') errors.push(`${path}.exact is not boolean.`);
  if (errors.length > 0) return false;
  const fit = value as unknown as FitSummary;
  if (!Number.isInteger(fit.n) || !Number.isInteger(fit.df)) errors.push(`${path} n/df must be integers.`);
  if (expectedN !== null && fit.n !== expectedN) errors.push(`${path}.n does not match the dataset row count.`);
  if (expectedDfOffset !== null && fit.df !== fit.n - expectedDfOffset) errors.push(`${path}.df is inconsistent with n.`);
  if (!(fit.lo <= fit.estimate && fit.estimate <= fit.hi)) errors.push(`${path} interval is not ordered around the estimate.`);
  if (fit.se < 0 || fit.sse < 0) errors.push(`${path} has a negative SE or SSE.`);
  if (fit.exact && (fit.se !== 0 || fit.lo !== fit.hi)) errors.push(`${path} is marked exact but has a non-point interval.`);
  if (fit.pDescriptive < 0 || fit.pDescriptive > 1) errors.push(`${path}.pDescriptive is out of range.`);
  return true;
}

function checkClaimed(value: unknown, fit: FitSummary, protocol: ProtocolV1, path: string, errors: string[]): void {
  if (!isObject(value) || !keysExactly(value, ['L', 'U', 'state'])) {
    errors.push(`${path} has the wrong shape.`);
    return;
  }
  const expected = claimedInterval(fit.lo, fit.hi, protocol.claim.direction, protocol.claim.delta);
  const claimed = value as unknown as ClaimedInterval;
  if (claimed.L !== expected.L || claimed.U !== expected.U || claimed.state !== expected.state) {
    errors.push(`${path} does not match the δ comparison of its own interval.`);
  }
}

function checkPayload(attempt: TerminalAttempt, protocol: ProtocolV1, errors: string[]): void {
  const payload = attempt.payload as unknown;
  const path = `attempt ${attempt.ordinal} payload`;
  if (!isObject(payload) || payload.kind !== attempt.kind) {
    errors.push(`${path} kind does not match the recipe.`);
    return;
  }
  const n = protocol.dataset.rowCount;
  const before = errors.length;
  switch (attempt.kind) {
    case 'baseline_ols': {
      if (!keysExactly(payload, ['kind', 'fit', 'claimed'])) errors.push(`${path} has the wrong shape.`);
      if (checkFit(payload.fit, `${path}.fit`, errors, 2, n)) {
        checkClaimed(payload.claimed, payload.fit, protocol, `${path}.claimed`, errors);
        const state = (payload.claimed as ClaimedInterval).state;
        const outcome = state === 'above' ? 'baseline_reproduced' : state === 'below' ? 'baseline_not_reproduced' : 'inconclusive';
        if (errors.length === before && attempt.outcome !== outcome) errors.push(`${path} outcome does not follow from its interval.`);
      }
      return;
    }
    case 'adjusted_ols': {
      if (!keysExactly(payload, ['kind', 'covariate', 'fit', 'claimed', 'residualVarianceRatio'])) errors.push(`${path} has the wrong shape.`);
      if (payload.covariate !== protocol.claim.z) errors.push(`${path} covariate is not the frozen covariate.`);
      if (!isFiniteNumber(payload.residualVarianceRatio) || payload.residualVarianceRatio < protocol.minResidualVarianceRatio || payload.residualVarianceRatio > 1 + 1e-12) {
        errors.push(`${path} residual variance ratio is invalid.`);
      }
      if (checkFit(payload.fit, `${path}.fit`, errors, 3, n)) {
        checkClaimed(payload.claimed, payload.fit, protocol, `${path}.claimed`, errors);
        const state = (payload.claimed as ClaimedInterval).state;
        const outcome = state === 'below' ? 'challenged_primary' : state === 'above' ? 'retained_primary' : 'inconclusive';
        if (errors.length === before && attempt.outcome !== outcome) errors.push(`${path} outcome does not follow from its interval.`);
      }
      return;
    }
    case 'influence': {
      const keys = ['kind', 'nOriginal', 'threshold', 'maxCookD', 'candidates', 'nReduced', 'reduced', 'reducedClaimed', 'differenceFromOriginal', 'reversed'];
      if (!keysExactly(payload, keys)) errors.push(`${path} has the wrong shape.`);
      if (payload.nOriginal !== n) errors.push(`${path}.nOriginal does not match the dataset.`);
      if (!isFiniteNumber(payload.threshold) || !isFiniteNumber(payload.maxCookD)) errors.push(`${path} has non-finite diagnostics.`);
      const candidates = payload.candidates;
      if (
        !Array.isArray(candidates) ||
        !candidates.every((index, i) => Number.isInteger(index) && index >= 0 && index < n && (i === 0 || index > candidates[i - 1]))
      ) {
        errors.push(`${path}.candidates must be sorted unique row indices.`);
        return;
      }
      if (candidates.length === 0) {
        if (payload.nReduced !== null || payload.reduced !== null || payload.reducedClaimed !== null || payload.differenceFromOriginal !== null || payload.reversed !== null) {
          errors.push(`${path} has a reduced fit without candidates.`);
        }
        if (attempt.outcome !== 'no_flag') errors.push(`${path} outcome must be no_flag without candidates.`);
        return;
      }
      if (payload.nReduced !== n - candidates.length) errors.push(`${path}.nReduced is inconsistent with the mask.`);
      if (checkFit(payload.reduced, `${path}.reduced`, errors, 2, n - candidates.length)) {
        checkClaimed(payload.reducedClaimed, payload.reduced, protocol, `${path}.reducedClaimed`, errors);
        if (!isFiniteNumber(payload.differenceFromOriginal)) errors.push(`${path}.differenceFromOriginal is not finite.`);
        const reversed = (protocol.claim.direction === 'positive' ? 1 : -1) * payload.reduced.estimate < 0;
        if (payload.reversed !== reversed) errors.push(`${path}.reversed is inconsistent.`);
        const flagged = reversed || (payload.reducedClaimed as ClaimedInterval).state === 'below';
        if (errors.length === before && attempt.outcome !== (flagged ? 'sensitivity_flag' : 'no_flag')) {
          errors.push(`${path} outcome does not follow from the reduced fit.`);
        }
      }
      return;
    }
    case 'rank_sensitivity': {
      if (!keysExactly(payload, ['kind', 'fit', 'reversed', 'intervalContainsZero'])) errors.push(`${path} has the wrong shape.`);
      if (checkFit(payload.fit, `${path}.fit`, errors, 2, n)) {
        const reversed = (protocol.claim.direction === 'positive' ? 1 : -1) * payload.fit.estimate < 0;
        if (payload.reversed !== reversed) errors.push(`${path}.reversed is inconsistent.`);
        if (payload.intervalContainsZero !== (payload.fit.lo <= 0 && payload.fit.hi >= 0)) errors.push(`${path}.intervalContainsZero is inconsistent.`);
        if (errors.length === before && attempt.outcome !== (reversed ? 'sensitivity_flag' : 'no_flag')) {
          errors.push(`${path} outcome does not follow from the rank slope.`);
        }
      }
      return;
    }
    case 'predictor_permutation': {
      if (!keysExactly(payload, ['kind', 'permutations', 'seed', 'observedAbsSlope', 'exceedances', 'tailProportion'])) {
        errors.push(`${path} has the wrong shape.`);
        return;
      }
      const recipe = protocol.recipes[attempt.ordinal];
      if (payload.permutations !== recipe.parameters.permutations) errors.push(`${path}.permutations is not the frozen budget.`);
      if (payload.seed !== recipe.parameters.permutationSeed) errors.push(`${path}.seed is not the frozen seed.`);
      const b = payload.permutations as number;
      const exceedances = payload.exceedances;
      if (!Number.isInteger(exceedances) || (exceedances as number) < 0 || (exceedances as number) > b) {
        errors.push(`${path}.exceedances is out of range.`);
      } else if (payload.tailProportion !== (1 + (exceedances as number)) / (b + 1)) {
        errors.push(`${path}.tailProportion is not (1 + exceedances) / (B + 1).`);
      }
      if (!isFiniteNumber(payload.observedAbsSlope) || payload.observedAbsSlope < 0) errors.push(`${path}.observedAbsSlope is invalid.`);
      if (attempt.outcome !== 'no_flag') errors.push(`${path} permutation never flags.`);
      return;
    }
    default:
      errors.push(`${path} has an unknown kind.`);
  }
}

/** Validates one terminal attempt against the frozen protocol. */
export function validateAttempt(value: unknown, protocol: ProtocolV1): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['An attempt is not an object.'];
  if (!keysExactly(value, ['ordinal', 'kind', 'role', 'recipeHash', 'outcome', 'reasonCode', 'reason', 'payload', 'payloadHash'])) {
    return ['An attempt has the wrong fields.'];
  }
  const ordinal = value.ordinal;
  if (!Number.isInteger(ordinal) || (ordinal as number) < 0 || (ordinal as number) >= RECIPE_KINDS.length) return ['An attempt ordinal is invalid.'];
  const attempt = value as unknown as TerminalAttempt;
  const recipe = protocol.recipes[attempt.ordinal];
  if (attempt.kind !== recipe.kind || attempt.role !== roleOf(recipe.kind)) errors.push(`attempt ${attempt.ordinal} kind/role does not match its ordinal.`);
  if (attempt.recipeHash !== recipeHash(recipe)) errors.push(`attempt ${attempt.ordinal} is bound to a different recipe.`);
  if (!(OUTCOME_CLASSES as readonly string[]).includes(attempt.outcome) || !ALLOWED[recipe.kind].includes(attempt.outcome)) {
    errors.push(`attempt ${attempt.ordinal} has an outcome its recipe cannot produce.`);
  }
  if (typeof attempt.reasonCode !== 'string' || attempt.reasonCode.length > 80) errors.push(`attempt ${attempt.ordinal} reason code is invalid.`);
  if (typeof attempt.reason !== 'string' || attempt.reason.length > 1000) errors.push(`attempt ${attempt.ordinal} reason is invalid.`);
  if (typeof attempt.payloadHash !== 'string' || !HASH_PATTERN.test(attempt.payloadHash)) errors.push(`attempt ${attempt.ordinal} payload hash is invalid.`);
  if (errors.length > 0) return errors;
  if (recipe.kind === 'adjusted_ols' && protocol.claim.z === null && attempt.outcome !== 'inapplicable' && NON_RESULT.includes(attempt.outcome) === false) {
    errors.push('attempt 1 reports a primary result although no covariate was declared.');
    return errors;
  }
  if (NON_RESULT.includes(attempt.outcome)) {
    if (attempt.payload !== null) errors.push(`attempt ${attempt.ordinal} reports ${attempt.outcome} but carries numbers.`);
  } else if (attempt.payload === null) {
    errors.push(`attempt ${attempt.ordinal} reports ${attempt.outcome} without a payload.`);
  } else {
    checkPayload(attempt, protocol, errors);
  }
  if (errors.length === 0) {
    let hash: string | null = null;
    try {
      hash = terminalHash(attempt);
    } catch {
      hash = null;
    }
    if (hash !== attempt.payloadHash) errors.push(`attempt ${attempt.ordinal} payload hash does not match its content.`);
  }
  return errors;
}

/**
 * Validates an execution: binding to the protocol hash, one attempt per expected
 * ordinal, nothing extra. A completed or terminated execution with a missing slot
 * is an integrity failure; a running one may be partial.
 */
export function validateExecution(execution: ExecutionRecord, protocol: ProtocolV1, protocolHash: string): string[] {
  const errors: string[] = [];
  if (execution.protocolHash !== protocolHash) errors.push('An execution is bound to a different protocol.');
  const expected = new Set(expectedOrdinals(execution.scope));
  const seen = new Set<number>();
  for (const attempt of execution.attempts) {
    const attemptErrors = validateAttempt(attempt, protocol);
    errors.push(...attemptErrors);
    if (attemptErrors.length > 0) continue;
    if (!expected.has(attempt.ordinal)) errors.push(`attempt ${attempt.ordinal} is outside this execution's scope.`);
    if (seen.has(attempt.ordinal)) errors.push(`attempt ${attempt.ordinal} appears twice.`);
    seen.add(attempt.ordinal);
  }
  if (execution.status !== 'running') {
    for (const ordinal of expected) if (!seen.has(ordinal)) errors.push(`The execution is missing a terminal record for recipe ${ordinal}.`);
  }
  if (errors.length === 0) errors.push(...crossCheck(execution, protocol));
  errors.push(...checkEvents(execution));
  return errors;
}

/** Consistency between records of one execution that each look valid on their own. */
function crossCheck(execution: ExecutionRecord, protocol: ProtocolV1): string[] {
  const errors: string[] = [];
  const byOrdinal = new Map(execution.attempts.map((attempt) => [attempt.ordinal, attempt]));
  const baseline = byOrdinal.get(0)?.payload;
  const baselineFit = baseline?.kind === 'baseline_ols' ? baseline.fit : null;
  const influence = byOrdinal.get(2)?.payload;
  if (influence?.kind === 'influence') {
    if (influence.threshold !== protocol.influence.cookMultiplier / protocol.dataset.rowCount) {
      errors.push('influence threshold is not the frozen multiplier / n.');
    }
    if (influence.candidates.length > 0 && !(influence.maxCookD > influence.threshold)) {
      errors.push('influence reports candidates but no Cook’s D above the threshold.');
    }
    if (baselineFit && influence.reduced && influence.differenceFromOriginal !== null
        && !numbersMatch(influence.differenceFromOriginal, influence.reduced.estimate - baselineFit.estimate)) {
      errors.push('influence difference does not equal reduced minus baseline slope.');
    }
  }
  const permutation = byOrdinal.get(4)?.payload;
  if (permutation?.kind === 'predictor_permutation' && baselineFit && !numbersMatch(permutation.observedAbsSlope, Math.abs(baselineFit.estimate))) {
    errors.push('permutation observed slope does not match the baseline slope.');
  }
  return errors;
}

const EVENT_TYPES = new Set([
  'execution_started',
  'attempt_started',
  'attempt_finished',
  'attempt_timed_out',
  'execution_cancelled',
  'execution_interrupted',
  'execution_finished',
]);

function checkEvents(execution: ExecutionRecord): string[] {
  if (!Array.isArray(execution.events)) return ['execution events are not a list.'];
  for (const [index, event] of execution.events.entries()) {
    const value = event as unknown;
    if (
      !isObject(value) ||
      value.seq !== index ||
      typeof value.at !== 'string' ||
      !EVENT_TYPES.has(value.type as string) ||
      !(value.ordinal === null || (Number.isInteger(value.ordinal) && (value.ordinal as number) >= 0 && (value.ordinal as number) <= 4)) ||
      (value.label !== 'locally_observed' && value.label !== 'server_receipt')
    ) {
      return [`execution event ${index} is malformed.`];
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* ReportFacts: every number shown in prose or charts comes from here. */

type MetricSpec = { path: string; unit: string };

function metricSpecs(payload: AttemptPayload, protocol: ProtocolV1): MetricSpec[] {
  const slope = `${protocol.claim.yUnits} per ${protocol.claim.xUnits}`;
  const fit = (prefix: string, unit: string): MetricSpec[] => [
    { path: `${prefix}.estimate`, unit },
    { path: `${prefix}.se`, unit },
    { path: `${prefix}.lo`, unit },
    { path: `${prefix}.hi`, unit },
    { path: `${prefix}.n`, unit: 'rows' },
    { path: `${prefix}.df`, unit: 'degrees of freedom' },
    { path: `${prefix}.tCrit`, unit: 't quantile' },
    { path: `${prefix}.pDescriptive`, unit: 'descriptive p' },
  ];
  switch (payload.kind) {
    case 'baseline_ols':
      return [...fit('fit', slope), { path: 'claimed.L', unit: slope }, { path: 'claimed.U', unit: slope }];
    case 'adjusted_ols':
      return [...fit('fit', slope), { path: 'claimed.L', unit: slope }, { path: 'claimed.U', unit: slope }, { path: 'residualVarianceRatio', unit: 'ratio' }];
    case 'influence':
      return [
        { path: 'nOriginal', unit: 'rows' },
        { path: 'threshold', unit: 'Cook’s D' },
        { path: 'maxCookD', unit: 'Cook’s D' },
        { path: 'candidates.length', unit: 'rows' },
        ...(payload.reduced ? [...fit('reduced', slope), { path: 'nReduced', unit: 'rows' }, { path: 'differenceFromOriginal', unit: slope }] : []),
      ];
    case 'rank_sensitivity':
      return fit('fit', 'rank per rank');
    case 'predictor_permutation':
      return [
        { path: 'permutations', unit: 'shuffles' },
        { path: 'exceedances', unit: 'shuffles' },
        { path: 'tailProportion', unit: 'proportion' },
        { path: 'observedAbsSlope', unit: slope },
      ];
    default:
      return [];
  }
}

function readPath(value: unknown, path: string): number | null {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (part === 'length' && Array.isArray(current)) return current.length;
    if (!isObject(current)) return null;
    current = current[part];
  }
  return isFiniteNumber(current) ? current : null;
}

/** Facts for one validated execution. Call only after validateExecution returned no errors. */
export function factsFor(execution: ExecutionRecord, protocol: ProtocolV1): ReportFactV1[] {
  const facts: ReportFactV1[] = [];
  for (const attempt of execution.attempts) {
    if (!attempt.payload) continue;
    for (const spec of metricSpecs(attempt.payload, protocol)) {
      const value = readPath(attempt.payload, spec.path);
      if (value === null) continue;
      facts.push({
        factId: `${execution.executionId}:${attempt.ordinal}:${spec.path}`,
        executionId: execution.executionId,
        attemptOrdinal: attempt.ordinal,
        metricPath: spec.path,
        value,
        unit: spec.unit,
        ruleId: 'fact-v1',
        inputHash: protocol.dataset.normalizedHash,
        recipeHash: attempt.recipeHash,
      });
    }
  }
  return facts;
}

export class FactBook {
  private readonly byKey = new Map<string, ReportFactV1>();

  constructor(facts: readonly ReportFactV1[]) {
    for (const fact of facts) this.byKey.set(`${fact.attemptOrdinal}:${fact.metricPath}`, fact);
  }

  /** Resolves a fact reference; a missing reference is a grounding failure, not a blank. */
  get(ordinal: number, metricPath: string): ReportFactV1 {
    const fact = this.byKey.get(`${ordinal}:${metricPath}`);
    if (!fact) throw new Error(`Unresolved fact ${ordinal}:${metricPath}.`);
    return fact;
  }

  has(ordinal: number, metricPath: string): boolean {
    return this.byKey.has(`${ordinal}:${metricPath}`);
  }
}

/* ------------------------------------------------------------------ */
/* Replay comparison. */

export const REPLAY_ABS = 1e-12;
export const REPLAY_REL = 1e-9;

export type FieldDiff = { path: string; stored: string; rerun: string; kind: 'numeric' | 'exact' };

export function numbersMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= REPLAY_ABS + REPLAY_REL * Math.max(Math.abs(a), Math.abs(b));
}

/**
 * Field-level comparison. Scientific numbers use |a-b| <= 1e-12 + 1e-9*max(|a|,|b|);
 * integers that are counts, indices, n, df, seeds and every non-number compare exactly.
 * The payload hash is not compared (it differs whenever any number differs in the last bit).
 */
export function diffAttempts(stored: TerminalAttempt, rerun: TerminalAttempt): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const exactNumberKeys = new Set(['n', 'df', 'nOriginal', 'nReduced', 'permutations', 'seed', 'exceedances', 'ordinal']);
  const walk = (a: unknown, b: unknown, path: string, key: string) => {
    if (typeof a === 'number' && typeof b === 'number') {
      const exact = exactNumberKeys.has(key) || path.includes('candidates');
      const same = exact ? a === b : numbersMatch(a, b);
      if (!same) diffs.push({ path, stored: String(a), rerun: String(b), kind: exact ? 'exact' : 'numeric' });
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) diffs.push({ path: `${path}.length`, stored: String(a.length), rerun: String(b.length), kind: 'exact' });
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) walk(a[i], b[i], `${path}[${i}]`, key);
      return;
    }
    if (isObject(a) && isObject(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const child of keys) walk(a[child], b[child], path ? `${path}.${child}` : child, child);
      return;
    }
    if (a !== b) diffs.push({ path, stored: JSON.stringify(a) ?? 'undefined', rerun: JSON.stringify(b) ?? 'undefined', kind: 'exact' });
  };
  walk(
    { ordinal: stored.ordinal, kind: stored.kind, role: stored.role, recipeHash: stored.recipeHash, outcome: stored.outcome, reasonCode: stored.reasonCode, payload: stored.payload },
    { ordinal: rerun.ordinal, kind: rerun.kind, role: rerun.role, recipeHash: rerun.recipeHash, outcome: rerun.outcome, reasonCode: rerun.reasonCode, payload: rerun.payload },
    '',
    '',
  );
  return diffs;
}
