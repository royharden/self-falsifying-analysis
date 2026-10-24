import { selectConfounder } from './attacks';
import { validateTable } from './table';
import type { AttackKind, AttackProgram, ClaimSpec, FrozenPlan, Table } from './types';
import { isAttackKind, isDirection } from './types';

export const DEFAULT_ALPHA = 0.05;
export const DEFAULT_REPLICATES = 199;
export const BENCH_REPLICATES = 49;
export const PLANNER_DAILY_LIMIT = 24;

export function clampSeed(seed: number): number | null {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) return null;
  return seed;
}

export function programFor(
  kind: AttackKind,
  claim: ClaimSpec,
  seed: number,
  alpha: number,
  replicates: number,
  confounder: string | null,
): AttackProgram {
  return {
    kind,
    seed,
    predictor: claim.predictor,
    outcome: claim.outcome,
    direction: claim.direction,
    alpha,
    placeboReplicates: replicates,
    subsetFolds: 3,
    confounder: kind === 'confounder_control' ? confounder : null,
    spec: 'rank',
  };
}

export function validateClaim(table: Table, claim: ClaimSpec): string | null {
  const statement = claim.statement.trim();
  if (!statement || statement.length > 500) return 'Write a claim of at most 500 characters.';
  if (!isDirection(claim.direction)) return 'Direction must be positive, negative, or nonzero.';
  if (!table.columns.includes(claim.outcome) || !table.columns.includes(claim.predictor)) {
    return 'Outcome and predictor must be columns in the table.';
  }
  if (claim.outcome === claim.predictor) return 'Outcome and predictor must be different columns.';
  if (claim.confounder && !table.columns.includes(claim.confounder)) return 'The named confounder is not a column.';
  if (claim.confounder === claim.outcome || claim.confounder === claim.predictor) {
    return 'The confounder must be a different column.';
  }
  return null;
}

export function buildDeterministicPlan(
  table: Table,
  claim: ClaimSpec,
  options?: { seed?: number; alpha?: number; placeboReplicates?: number },
): { ok: true; plan: FrozenPlan } | { ok: false; error: string } {
  const tableError = validateTable(table);
  if (tableError) return { ok: false, error: tableError };
  const claimError = validateClaim(table, claim);
  if (claimError) return { ok: false, error: claimError };
  const seed = clampSeed(options?.seed ?? 19019);
  if (seed === null) return { ok: false, error: 'Seed must be an integer from 0 to 2147483647.' };
  const alpha = options?.alpha ?? DEFAULT_ALPHA;
  if (!(alpha >= 0.001 && alpha <= 0.2)) return { ok: false, error: 'Alpha must be between 0.001 and 0.2.' };
  const replicates = options?.placeboReplicates ?? DEFAULT_REPLICATES;
  if (!Number.isInteger(replicates) || replicates < 19 || replicates > 499) {
    return { ok: false, error: 'Placebo replicates must be an integer from 19 to 499.' };
  }
  const confounder = selectConfounder(table, claim);
  const kinds: AttackKind[] = [
    'naive',
    'placebo_shuffle',
    'confounder_control',
    'subset_stability',
    'alternative_spec',
  ];
  return {
    ok: true,
    plan: {
      planner: 'deterministic',
      seed,
      alpha,
      placeboReplicates: replicates,
      rationale: null,
      programs: kinds.map((kind) => programFor(kind, claim, seed, alpha, replicates, confounder)),
    },
  };
}

export type ModelAttack = { kind: string; confounder: string | null };

/**
 * Turns a model menu into a frozen plan. The model cannot set the seed,
 * alpha, replicate count, or any estimate. An unknown confounder name falls
 * back to the column chosen before the call. Invalid menus are rejected.
 */
export function freezeModelPlan(
  attacks: readonly ModelAttack[],
  context: {
    table: Table;
    claim: ClaimSpec;
    seed: number;
    alpha: number;
    placeboReplicates: number;
    rationale: string;
  },
): { ok: true; plan: FrozenPlan } | { ok: false; error: string } {
  const tableError = validateTable(context.table);
  if (tableError) return { ok: false, error: tableError };
  const claimError = validateClaim(context.table, context.claim);
  if (claimError) return { ok: false, error: claimError };
  const seed = clampSeed(context.seed);
  if (seed === null) return { ok: false, error: 'Seed must be an integer from 0 to 2147483647.' };
  if (!(context.alpha >= 0.001 && context.alpha <= 0.2)) {
    return { ok: false, error: 'Alpha must be between 0.001 and 0.2.' };
  }
  if (!Number.isInteger(context.placeboReplicates) || context.placeboReplicates < 19 || context.placeboReplicates > 499) {
    return { ok: false, error: 'Placebo replicates must be an integer from 19 to 499.' };
  }
  if (context.rationale.length > 400) return { ok: false, error: 'Planner note is longer than 400 characters.' };
  if (attacks.length < 2 || attacks.length > 5) return { ok: false, error: 'The model menu must contain 2 to 5 attacks.' };
  if (attacks[0]?.kind !== 'naive') return { ok: false, error: 'The first attack must be naive.' };
  const seen = new Set<string>();
  for (const attack of attacks) {
    if (!isAttackKind(attack.kind)) return { ok: false, error: `Unknown attack "${attack.kind}".` };
    if (seen.has(attack.kind)) return { ok: false, error: `Duplicate attack "${attack.kind}".` };
    seen.add(attack.kind);
    if (attack.confounder !== null && typeof attack.confounder !== 'string') {
      return { ok: false, error: 'A confounder must be a column name or null.' };
    }
  }
  if (![...seen].some((kind) => kind !== 'naive')) {
    return { ok: false, error: 'The menu must include a robustness attack.' };
  }
  const auto = selectConfounder(context.table, context.claim);
  const programs = attacks.map((attack) => {
    const kind = attack.kind as AttackKind;
    let confounder: string | null = null;
    if (kind === 'confounder_control') {
      const requested = attack.confounder;
      if (
        requested &&
        context.table.columns.includes(requested) &&
        requested !== context.claim.predictor &&
        requested !== context.claim.outcome
      ) {
        confounder = requested;
      } else {
        confounder = auto;
      }
    }
    return programFor(kind, context.claim, seed, context.alpha, context.placeboReplicates, confounder);
  });
  return {
    ok: true,
    plan: {
      planner: 'llm',
      seed,
      alpha: context.alpha,
      placeboReplicates: context.placeboReplicates,
      rationale: context.rationale.trim() || null,
      programs,
    },
  };
}
