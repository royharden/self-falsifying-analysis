import { describe, expect, it } from 'vitest';
import { workshopFixture } from '../src/lib/falsify/generate';
import {
  buildProtocol,
  DEFAULT_SECONDARY_ORDER,
  executionOrder,
  validateProtocol,
  type ClaimDraft,
  type ProtocolInput,
} from '../src/lib/falsify/planSchema';

const fixture = workshopFixture('confounded');

const draft: ClaimDraft = {
  statement: 'More workshop hours raise the final score.',
  x: 'hours',
  y: 'final_score',
  covariate: { kind: 'asserted', column: 'prior_score', confirmed: true },
  direction: 'positive',
  delta: 0.5,
  xUnits: 'hours',
  yUnits: 'points',
  iidAcknowledged: true,
};

const input = (claim: Partial<ClaimDraft> = {}, rest: Partial<ProtocolInput> = {}): ProtocolInput => ({
  table: fixture.table,
  dataset: fixture.dataset,
  claim: { ...draft, ...claim },
  seed: 19019,
  permutations: 199,
  secondaryOrder: DEFAULT_SECONDARY_ORDER,
  engineSourceDigest: 'a'.repeat(64),
  parentAnalysisId: null,
  ...rest,
});

describe('protocol freeze', () => {
  it('requires an explicit covariate choice, confirmation, iid acknowledgement and delta > 0', () => {
    expect(buildProtocol(input({ covariate: null })).ok).toBe(false);
    expect(buildProtocol(input({ covariate: { kind: 'asserted', column: 'prior_score', confirmed: false } })).ok).toBe(false);
    expect(buildProtocol(input({ iidAcknowledged: false })).ok).toBe(false);
    expect(buildProtocol(input({ delta: 0 })).ok).toBe(false);
    expect(buildProtocol(input({ y: 'hours' })).ok).toBe(false);
    expect(buildProtocol(input({ covariate: { kind: 'asserted', column: 'hours', confirmed: true } })).ok).toBe(false);
  });

  it('caps permutations at 499', () => {
    expect(buildProtocol(input({}, { permutations: 500 })).ok).toBe(false);
  });

  it('hashes deterministically and changes when delta changes', () => {
    const a = buildProtocol(input());
    const b = buildProtocol(input());
    const c = buildProtocol(input({ delta: 0.6 }));
    if (!a.ok || !b.ok || !c.ok) throw new Error('freeze failed');
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });

  it('keeps baseline and primary first in the execution order', () => {
    const built = buildProtocol(input({}, { secondaryOrder: ['predictor_permutation', 'influence', 'rank_sensitivity'] }));
    if (!built.ok) throw new Error('freeze failed');
    expect(executionOrder(built.protocol)).toEqual([0, 1, 4, 2, 3]);
    expect(built.protocol.recipes.map((recipe) => recipe.ordinal)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('protocol validation', () => {
  const built = buildProtocol(input());
  if (!built.ok) throw new Error('freeze failed');
  const roundTrip = () => JSON.parse(JSON.stringify(built.protocol)) as Record<string, unknown>;

  it('accepts a JSON round trip', () => {
    expect(validateProtocol(roundTrip(), fixture.table.columns).ok).toBe(true);
  });

  it('rejects unknown fields and tampered recipes', () => {
    expect(validateProtocol({ ...roundTrip(), extra: 1 }, null).ok).toBe(false);
    const tampered = roundTrip();
    (tampered.recipes as { parameters: { delta: number } }[])[1].parameters.delta = 0.01;
    expect(validateProtocol(tampered, null).ok).toBe(false);
  });

  it('reports unknown versions as unsupported (read-only)', () => {
    const result = validateProtocol({ ...roundTrip(), engineVersion: 's19-engine-9.9.9' }, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unsupportedVersion).toBe(true);
  });

  it('rejects a claim column that is not in the dataset', () => {
    const value = roundTrip();
    expect(validateProtocol(value, ['hours', 'final_score']).ok).toBe(false);
  });
});
