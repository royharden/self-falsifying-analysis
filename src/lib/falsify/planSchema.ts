import { canonicalHash, HASH_PATTERN } from './canonical';
import { MIN_RESIDUAL_VARIANCE_RATIO } from './ols';
import { mixSeed } from './prng';
import { IDENTIFIER } from './table';
import {
  CATALOGUE_VERSION,
  COVARIATE_ROLE,
  ENGINE_VERSION,
  POLICY_ID,
  POLICY_VERSION,
  RECIPE_KINDS,
  SCHEMA_VERSION,
  SECONDARY_KINDS,
  isDirection,
  isSecondaryKind,
  roleOf,
  type ClaimV1,
  type DatasetIdentity,
  type Direction,
  type InfluencePolicy,
  type ProtocolV1,
  type RecipeV1,
  type SecondaryKind,
  type Table,
} from './types';

export const DEFAULT_SEED = 19019;
export const MAX_SEED = 2147483647;
export const DEFAULT_PERMUTATIONS = 199;
export const MIN_PERMUTATIONS = 19;
export const MAX_PERMUTATIONS = 499;
export const ATTEMPT_DEADLINE_MS = 10_000;
export const MAX_STATEMENT = 2000;
export const MAX_UNITS = 128;
export const DEFAULT_INFLUENCE: InfluencePolicy = { cookMultiplier: 4, maxCandidateFraction: 0.05, minRetainedRows: 12 };
export const DEFAULT_SECONDARY_ORDER: SecondaryKind[] = [...SECONDARY_KINDS];
/** Salt for the permutation recipe's PRNG stream: its ordinal. */
export const PERMUTATION_SALT = RECIPE_KINDS.indexOf('predictor_permutation');

export type CovariateChoice = { kind: 'asserted'; column: string; confirmed: boolean } | { kind: 'none' } | null;

export type ClaimDraft = {
  statement: string;
  x: string;
  y: string;
  covariate: CovariateChoice;
  direction: Direction;
  delta: number;
  xUnits: string;
  yUnits: string;
  iidAcknowledged: boolean;
};

export type ProtocolInput = {
  table: Table;
  dataset: DatasetIdentity;
  claim: ClaimDraft;
  seed: number;
  permutations: number;
  secondaryOrder: SecondaryKind[];
  engineSourceDigest: string;
  parentAnalysisId: string | null;
};

export function validateClaimDraft(table: Table, draft: ClaimDraft): string[] {
  const errors: string[] = [];
  const statement = draft.statement.trim();
  if (statement === '' || statement.length > MAX_STATEMENT) errors.push(`Write a claim of 1 to ${MAX_STATEMENT} characters.`);
  if (!isDirection(draft.direction)) errors.push('Direction must be positive or negative.');
  if (!table.columns.includes(draft.x)) errors.push('Choose a predictor column.');
  if (!table.columns.includes(draft.y)) errors.push('Choose an outcome column.');
  if (draft.x === draft.y) errors.push('Predictor and outcome must be different columns.');
  if (!(typeof draft.delta === 'number' && Number.isFinite(draft.delta) && draft.delta > 0)) {
    errors.push('The practical threshold δ must be a finite number greater than zero.');
  }
  for (const [label, units] of [
    ['Predictor units', draft.xUnits],
    ['Outcome units', draft.yUnits],
  ] as const) {
    const trimmed = units.trim();
    if (trimmed === '' || trimmed.length > MAX_UNITS) errors.push(`${label}: 1 to ${MAX_UNITS} characters.`);
  }
  if (!draft.iidAcknowledged) {
    errors.push('Acknowledge the independent-rows assumption. The app does not check it.');
  }
  const covariate = draft.covariate;
  if (covariate === null) {
    errors.push('Choose one asserted pre-exposure common cause, or explicitly choose no defensible covariate.');
  } else if (covariate.kind === 'asserted') {
    if (!table.columns.includes(covariate.column)) errors.push('The covariate is not a column of this table.');
    if (covariate.column === draft.x || covariate.column === draft.y) {
      errors.push('The covariate must differ from the predictor and the outcome.');
    }
    if (!covariate.confirmed) {
      errors.push('Confirm that you assert the covariate is a pre-exposure common cause. Names and order do not establish that role.');
    }
  }
  return errors;
}

export function buildRecipes(
  claim: ClaimV1,
  inputHash: string,
  seed: number,
  permutations: number,
  engineSourceDigest: string,
): RecipeV1[] {
  return RECIPE_KINDS.map((kind, ordinal) => ({
    kind,
    version: 1 as const,
    ordinal,
    role: roleOf(kind),
    parameters: {
      x: claim.x,
      y: claim.y,
      z: kind === 'adjusted_ols' ? claim.z : null,
      direction: claim.direction,
      delta: claim.delta,
      permutations: kind === 'predictor_permutation' ? permutations : null,
      permutationSeed: kind === 'predictor_permutation' ? mixSeed(seed, PERMUTATION_SALT) : null,
    },
    inputHash,
    engineVersion: ENGINE_VERSION,
    engineSourceDigest,
  }));
}

export function buildProtocol(input: ProtocolInput): { ok: true; protocol: ProtocolV1; hash: string } | { ok: false; errors: string[] } {
  const errors = validateClaimDraft(input.table, input.claim);
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > MAX_SEED) {
    errors.push(`Seed must be an integer from 0 to ${MAX_SEED}.`);
  }
  if (!Number.isInteger(input.permutations) || input.permutations < MIN_PERMUTATIONS || input.permutations > MAX_PERMUTATIONS) {
    errors.push(`Permutations must be an integer from ${MIN_PERMUTATIONS} to ${MAX_PERMUTATIONS}.`);
  }
  if (!isSecondaryOrder(input.secondaryOrder)) errors.push('Secondary order must list each secondary recipe exactly once.');
  if (!HASH_PATTERN.test(input.engineSourceDigest)) errors.push('Engine source digest is missing.');
  if (input.dataset.rowCount !== input.table.rows.length || input.dataset.columnCount !== input.table.columns.length) {
    errors.push('Dataset identity does not match the table.');
  }
  if (errors.length > 0) return { ok: false, errors };
  const covariate = input.claim.covariate;
  const z = covariate && covariate.kind === 'asserted' ? covariate.column : null;
  const claim: ClaimV1 = {
    statement: input.claim.statement.trim(),
    x: input.claim.x,
    y: input.claim.y,
    z,
    zRole: z === null ? null : COVARIATE_ROLE,
    direction: input.claim.direction,
    delta: input.claim.delta,
    xUnits: input.claim.xUnits.trim(),
    yUnits: input.claim.yUnits.trim(),
    iidAcknowledged: true,
  };
  const protocol: ProtocolV1 = {
    schemaVersion: SCHEMA_VERSION,
    policyId: POLICY_ID,
    policyVersion: POLICY_VERSION,
    catalogueVersion: CATALOGUE_VERSION,
    engineVersion: ENGINE_VERSION,
    engineSourceDigest: input.engineSourceDigest,
    claim,
    dataset: input.dataset,
    seed: input.seed,
    permutations: input.permutations,
    attemptDeadlineMs: ATTEMPT_DEADLINE_MS,
    minResidualVarianceRatio: MIN_RESIDUAL_VARIANCE_RATIO,
    influence: { ...DEFAULT_INFLUENCE },
    recipes: buildRecipes(claim, input.dataset.normalizedHash, input.seed, input.permutations, input.engineSourceDigest),
    secondaryOrder: [...input.secondaryOrder],
    parentAnalysisId: input.parentAnalysisId,
  };
  return { ok: true, protocol, hash: protocolHash(protocol) };
}

export function protocolHash(protocol: ProtocolV1): string {
  return canonicalHash(protocol);
}

export function recipeHash(recipe: RecipeV1): string {
  return canonicalHash(recipe);
}

/** Execution order: baseline, primary, then the frozen secondary order. */
export function executionOrder(protocol: ProtocolV1): number[] {
  return [0, 1, ...protocol.secondaryOrder.map((kind) => RECIPE_KINDS.indexOf(kind))];
}

export function isSecondaryOrder(value: unknown): value is SecondaryKind[] {
  return (
    Array.isArray(value) &&
    value.length === SECONDARY_KINDS.length &&
    value.every(isSecondaryKind) &&
    new Set(value).size === SECONDARY_KINDS.length
  );
}

/* ------------------------------------------------------------------ */
/* Exact nested validation of a ProtocolV1 received from storage/share. */

type Errors = string[];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string, errors: Errors): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${path}.${key} is not allowed.`);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is missing.`);
}

function str(value: unknown, path: string, errors: Errors, max: number, pattern?: RegExp): void {
  if (typeof value !== 'string' || value.length > max || (pattern && !pattern.test(value))) errors.push(`${path} is invalid.`);
}

function int(value: unknown, path: string, errors: Errors, min: number, max: number): void {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) errors.push(`${path} is invalid.`);
}

function finite(value: unknown, path: string, errors: Errors): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path} is not a finite number.`);
}

function validateDataset(value: unknown, errors: Errors): void {
  if (!isObject(value)) {
    errors.push('protocol.dataset is invalid.');
    return;
  }
  exactKeys(value, ['normalizedHash', 'rowCount', 'columnCount', 'source'], 'protocol.dataset', errors);
  str(value.normalizedHash, 'protocol.dataset.normalizedHash', errors, 64, HASH_PATTERN);
  int(value.rowCount, 'protocol.dataset.rowCount', errors, 40, 5000);
  int(value.columnCount, 'protocol.dataset.columnCount', errors, 2, 24);
  const source = value.source;
  if (!isObject(source)) {
    errors.push('protocol.dataset.source is invalid.');
    return;
  }
  if (source.kind === 'csv') {
    exactKeys(source, ['kind', 'fileName', 'byteLength', 'originalHash', 'headerMap'], 'protocol.dataset.source', errors);
    str(source.fileName, 'protocol.dataset.source.fileName', errors, 200);
    int(source.byteLength, 'protocol.dataset.source.byteLength', errors, 1, 1_048_576);
    str(source.originalHash, 'protocol.dataset.source.originalHash', errors, 64, HASH_PATTERN);
    if (!Array.isArray(source.headerMap) || source.headerMap.length !== value.columnCount) {
      errors.push('protocol.dataset.source.headerMap is invalid.');
    } else {
      source.headerMap.forEach((entry, index) => {
        const path = `protocol.dataset.source.headerMap[${index}]`;
        if (!isObject(entry)) {
          errors.push(`${path} is invalid.`);
          return;
        }
        exactKeys(entry, ['source', 'id'], path, errors);
        str(entry.source, `${path}.source`, errors, 10_000);
        str(entry.id, `${path}.id`, errors, 41, IDENTIFIER);
      });
    }
  } else if (source.kind === 'fixture') {
    exactKeys(source, ['kind', 'fixtureId', 'generatorVersion', 'seed', 'parameters'], 'protocol.dataset.source', errors);
    str(source.fixtureId, 'protocol.dataset.source.fixtureId', errors, 80, /^[a-z0-9_.-]+$/);
    str(source.generatorVersion, 'protocol.dataset.source.generatorVersion', errors, 80);
    int(source.seed, 'protocol.dataset.source.seed', errors, 0, 0xffffffff);
    if (!isObject(source.parameters)) errors.push('protocol.dataset.source.parameters is invalid.');
    else {
      for (const [key, item] of Object.entries(source.parameters)) {
        str(key, 'protocol.dataset.source.parameters key', errors, 40, IDENTIFIER);
        finite(item, `protocol.dataset.source.parameters.${key}`, errors);
      }
    }
  } else {
    errors.push('protocol.dataset.source.kind is invalid.');
  }
}

function validateClaimShape(value: unknown, columnIds: readonly string[] | null, errors: Errors): void {
  if (!isObject(value)) {
    errors.push('protocol.claim is invalid.');
    return;
  }
  exactKeys(
    value,
    ['statement', 'x', 'y', 'z', 'zRole', 'direction', 'delta', 'xUnits', 'yUnits', 'iidAcknowledged'],
    'protocol.claim',
    errors,
  );
  str(value.statement, 'protocol.claim.statement', errors, MAX_STATEMENT);
  if (typeof value.statement === 'string' && value.statement.trim() === '') errors.push('protocol.claim.statement is empty.');
  str(value.x, 'protocol.claim.x', errors, 41, IDENTIFIER);
  str(value.y, 'protocol.claim.y', errors, 41, IDENTIFIER);
  if (value.x === value.y) errors.push('protocol.claim x and y are the same column.');
  if (value.z === null) {
    if (value.zRole !== null) errors.push('protocol.claim.zRole must be null without a covariate.');
  } else {
    str(value.z, 'protocol.claim.z', errors, 41, IDENTIFIER);
    if (value.z === value.x || value.z === value.y) errors.push('protocol.claim.z repeats x or y.');
    if (value.zRole !== COVARIATE_ROLE) errors.push('protocol.claim.zRole is invalid.');
  }
  if (!isDirection(value.direction)) errors.push('protocol.claim.direction is invalid.');
  finite(value.delta, 'protocol.claim.delta', errors);
  if (typeof value.delta === 'number' && !(value.delta > 0)) errors.push('protocol.claim.delta must be > 0.');
  str(value.xUnits, 'protocol.claim.xUnits', errors, MAX_UNITS);
  str(value.yUnits, 'protocol.claim.yUnits', errors, MAX_UNITS);
  if (value.iidAcknowledged !== true) errors.push('protocol.claim.iidAcknowledged must be true.');
  if (columnIds) {
    for (const key of ['x', 'y', 'z'] as const) {
      const id = value[key];
      if (typeof id === 'string' && !columnIds.includes(id)) errors.push(`protocol.claim.${key} is not a dataset column.`);
    }
  }
}

/**
 * Validates a parsed protocol exactly: allowed fields only, known versions, finite
 * values, recipes that equal what this protocol would build. Unknown versions are
 * reported with `unsupportedVersion` so callers can show the record read-only.
 */
export function validateProtocol(
  value: unknown,
  columnIds: readonly string[] | null,
): { ok: true; protocol: ProtocolV1 } | { ok: false; errors: string[]; unsupportedVersion: boolean } {
  const errors: Errors = [];
  if (!isObject(value)) return { ok: false, errors: ['The protocol is not an object.'], unsupportedVersion: false };
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    value.policyId !== POLICY_ID ||
    value.policyVersion !== POLICY_VERSION ||
    value.catalogueVersion !== CATALOGUE_VERSION ||
    value.engineVersion !== ENGINE_VERSION
  ) {
    return {
      ok: false,
      errors: ['This record was produced by a schema, policy or engine version this build does not replay.'],
      unsupportedVersion: true,
    };
  }
  exactKeys(
    value,
    [
      'schemaVersion',
      'policyId',
      'policyVersion',
      'catalogueVersion',
      'engineVersion',
      'engineSourceDigest',
      'claim',
      'dataset',
      'seed',
      'permutations',
      'attemptDeadlineMs',
      'minResidualVarianceRatio',
      'influence',
      'recipes',
      'secondaryOrder',
      'parentAnalysisId',
    ],
    'protocol',
    errors,
  );
  str(value.engineSourceDigest, 'protocol.engineSourceDigest', errors, 64, HASH_PATTERN);
  validateClaimShape(value.claim, columnIds, errors);
  validateDataset(value.dataset, errors);
  int(value.seed, 'protocol.seed', errors, 0, MAX_SEED);
  int(value.permutations, 'protocol.permutations', errors, MIN_PERMUTATIONS, MAX_PERMUTATIONS);
  if (value.attemptDeadlineMs !== ATTEMPT_DEADLINE_MS) errors.push('protocol.attemptDeadlineMs is not the frozen policy value.');
  if (value.minResidualVarianceRatio !== MIN_RESIDUAL_VARIANCE_RATIO) {
    errors.push('protocol.minResidualVarianceRatio is not the frozen policy value.');
  }
  if (!isObject(value.influence)) errors.push('protocol.influence is invalid.');
  else if (canonicalSafe(value.influence) !== canonicalSafe(DEFAULT_INFLUENCE)) {
    errors.push('protocol.influence is not the frozen policy value.');
  }
  if (!isSecondaryOrder(value.secondaryOrder)) errors.push('protocol.secondaryOrder is invalid.');
  if (value.parentAnalysisId !== null) str(value.parentAnalysisId, 'protocol.parentAnalysisId', errors, 80);
  if (errors.length === 0) {
    const protocol = value as unknown as ProtocolV1;
    const expected = buildRecipes(
      protocol.claim,
      protocol.dataset.normalizedHash,
      protocol.seed,
      protocol.permutations,
      protocol.engineSourceDigest,
    );
    if (canonicalSafe(value.recipes) !== canonicalSafe(expected)) {
      errors.push('protocol.recipes do not match the canonical recipes for this claim, seed and version.');
    }
  }
  if (errors.length > 0) return { ok: false, errors, unsupportedVersion: false };
  return { ok: true, protocol: value as unknown as ProtocolV1 };
}

function canonicalSafe(value: unknown): string | null {
  try {
    return canonicalHash(value);
  } catch {
    return null;
  }
}
