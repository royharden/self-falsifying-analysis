import { describe, expect, it } from 'vitest';
import { headlineFor } from '../src/lib/falsify/aggregate';
import { runRecipe } from '../src/lib/falsify/attacks';
import { workshopFixture } from '../src/lib/falsify/generate';
import { buildProtocol, DEFAULT_SECONDARY_ORDER, type CovariateChoice } from '../src/lib/falsify/planSchema';
import { runFull } from '../src/lib/falsify/runner';
import { normalizedTableHash } from '../src/lib/falsify/table';
import type { DatasetIdentity, Direction, ProtocolV1, Table } from '../src/lib/falsify/types';

const DIGEST = 'a'.repeat(64);

function identity(table: Table): DatasetIdentity {
  return {
    normalizedHash: normalizedTableHash(table),
    rowCount: table.rows.length,
    columnCount: table.columns.length,
    source: { kind: 'fixture', fixtureId: 'test', generatorVersion: 'test', seed: 0, parameters: {} },
  };
}

function protocolFor(
  table: Table,
  options: { covariate?: CovariateChoice; direction?: Direction; delta?: number; seed?: number } = {},
): ProtocolV1 {
  const built = buildProtocol({
    table,
    dataset: identity(table),
    claim: {
      statement: 'x moves y.',
      x: table.columns[0],
      y: table.columns[1],
      covariate: options.covariate ?? { kind: 'none' },
      direction: options.direction ?? 'positive',
      delta: options.delta ?? 0.5,
      xUnits: 'u',
      yUnits: 'v',
      iidAcknowledged: true,
    },
    seed: options.seed ?? 7,
    permutations: 199,
    secondaryOrder: DEFAULT_SECONDARY_ORDER,
    engineSourceDigest: DIGEST,
    parentAnalysisId: null,
  });
  if (!built.ok) throw new Error(built.errors.join('; '));
  return built.protocol;
}

/** Deterministic, roughly symmetric small noise without a PRNG. */
const wiggle = (i: number) => ((i * 37) % 11) / 10 - 0.5;

function line(n: number, slope: number): Table {
  return { columns: ['x', 'y'], rows: Array.from({ length: n }, (_, i) => [i, slope * i + wiggle(i)]) };
}

describe('workshop fixtures (target behaviour once activated)', () => {
  it('confounded demo: baseline reproduced, primary challenged', () => {
    const fixture = workshopFixture('confounded');
    const built = buildProtocol({
      table: fixture.table,
      dataset: fixture.dataset,
      claim: {
        statement: fixture.suggestion.statement,
        x: 'hours',
        y: 'final_score',
        covariate: { kind: 'asserted', column: 'prior_score', confirmed: true },
        direction: 'positive',
        delta: 0.5,
        xUnits: 'hours',
        yUnits: 'points',
        iidAcknowledged: true,
      },
      seed: 19019,
      permutations: 199,
      secondaryOrder: DEFAULT_SECONDARY_ORDER,
      engineSourceDigest: DIGEST,
      parentAnalysisId: null,
    });
    if (!built.ok) throw new Error(built.errors.join('; '));
    const attempts = runFull(fixture.table, built.protocol);
    expect(attempts.map((a) => a.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(attempts[0].outcome).toBe('baseline_reproduced');
    expect(attempts[1].outcome).toBe('challenged_primary');
    expect(headlineFor(built.protocol, attempts).code).toBe('challenged');
  });
});

describe('recipes', () => {
  it('never mutates the table rows', () => {
    const table = line(60, 2);
    const before = JSON.stringify(table);
    runFull(table, protocolFor(table));
    expect(JSON.stringify(table)).toBe(before);
  });

  it('marks the primary inapplicable when no covariate is declared', () => {
    const table = line(60, 2);
    const attempt = runRecipe(table, protocolFor(table), 1);
    expect(attempt.outcome).toBe('inapplicable');
    expect(attempt.reasonCode).toBe('no_covariate');
    expect(attempt.payload).toBeNull();
  });

  it('negative claims mirror positive claims', () => {
    const table = line(60, 2);
    const mirrored: Table = { columns: ['x', 'y'], rows: table.rows.map(([x, y]) => [x, -y]) };
    const pos = runRecipe(table, protocolFor(table), 0);
    const neg = runRecipe(mirrored, protocolFor(mirrored, { direction: 'negative' }), 0);
    expect(pos.outcome).toBe('baseline_reproduced');
    expect(neg.outcome).toBe('baseline_reproduced');
  });

  it('an opposite-direction effect is never supportive', () => {
    const table = line(60, -2);
    expect(runRecipe(table, protocolFor(table), 0).outcome).toBe('baseline_not_reproduced');
  });

  it('flags a planted high-influence row and keeps both row counts', () => {
    const table = line(60, 1);
    table.rows[59] = [200, -400];
    const attempt = runRecipe(table, protocolFor(table), 2);
    expect(attempt.payload?.kind).toBe('influence');
    if (attempt.payload?.kind !== 'influence') return;
    expect(attempt.payload.candidates).toContain(59);
    expect(attempt.payload.nOriginal).toBe(60);
    if (attempt.payload.nReduced !== null) expect(attempt.payload.nReduced).toBe(60 - attempt.payload.candidates.length);
  });

  it('marks influence inapplicable on an exact fit (zero MSE)', () => {
    const table: Table = { columns: ['x', 'y'], rows: Array.from({ length: 50 }, (_, i) => [i, 3 * i + 1]) };
    expect(runRecipe(table, protocolFor(table), 2).reasonCode).toBe('zero_mse');
  });

  it('rank sensitivity flags only a reversal and never applies delta', () => {
    const table = line(60, 0.1);
    const attempt = runRecipe(table, protocolFor(table, { delta: 1000 }), 3);
    expect(attempt.outcome).toBe('no_flag');
    const reversed = runRecipe(line(60, -1), protocolFor(line(60, -1)), 3);
    expect(reversed.outcome).toBe('sensitivity_flag');
  });

  it('permutation uses the plus-one proportion, is seeded and never flags', () => {
    const table = line(60, 2);
    const protocol = protocolFor(table);
    const first = runRecipe(table, protocol, 4);
    const second = runRecipe(table, protocol, 4);
    expect(first.payloadHash).toBe(second.payloadHash);
    expect(first.outcome).toBe('no_flag');
    if (first.payload?.kind !== 'predictor_permutation') throw new Error('missing payload');
    expect(first.payload.tailProportion).toBe((1 + first.payload.exceedances) / (first.payload.permutations + 1));
    expect(first.payload.tailProportion).toBeGreaterThanOrEqual(1 / 200);
  });

  it('refuses a recipe whose ordinal does not match its kind', () => {
    const table = line(60, 2);
    const protocol = protocolFor(table);
    const swapped: ProtocolV1 = { ...protocol, recipes: [protocol.recipes[1], protocol.recipes[0], ...protocol.recipes.slice(2)] };
    expect(() => runRecipe(table, swapped, 0)).toThrow();
  });
});
