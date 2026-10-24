import { describe, expect, it } from 'vitest';
import { freezeModelPlan } from '../src/lib/falsify/planSchema';
import type { ClaimSpec, Table } from '../src/lib/falsify/types';

const table: Table = {
  columns: ['x', 'y', 'z'],
  rows: Array.from({ length: 8 }, (_, index) => [index + 1, index + 2, index + 1]),
};

const claim: ClaimSpec = {
  statement: 'x raises y.',
  outcome: 'y',
  predictor: 'x',
  direction: 'positive',
  confounder: null,
};

const context = {
  table,
  claim,
  seed: 99,
  alpha: 0.05,
  placeboReplicates: 19,
  rationale: 'Control for z first.',
};

describe('plan schema', () => {
  it('freezes the server seed and falls back from an unknown confounder', () => {
    const frozen = freezeModelPlan(
      [
        { kind: 'naive', confounder: null },
        { kind: 'confounder_control', confounder: 'nope' },
      ],
      context,
    );
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    expect(frozen.plan.planner).toBe('llm');
    expect(frozen.plan.seed).toBe(99);
    expect(frozen.plan.programs[0]?.seed).toBe(99);
    expect(frozen.plan.programs[1]?.confounder).toBe('z');
    expect(frozen.plan.programs[1]?.placeboReplicates).toBe(19);
    expect(frozen.plan.rationale).toBe('Control for z first.');
  });

  it('rejects a menu that does not start with naive', () => {
    const frozen = freezeModelPlan(
      [
        { kind: 'placebo_shuffle', confounder: null },
        { kind: 'naive', confounder: null },
      ],
      context,
    );
    expect(frozen).toEqual({ ok: false, error: 'The first attack must be naive.' });
  });

  it('rejects duplicate and unknown attacks', () => {
    expect(
      freezeModelPlan(
        [
          { kind: 'naive', confounder: null },
          { kind: 'naive', confounder: null },
        ],
        context,
      ).ok,
    ).toBe(false);
    expect(
      freezeModelPlan(
        [
          { kind: 'naive', confounder: null },
          { kind: 'drop_rows', confounder: null },
        ],
        context,
      ).ok,
    ).toBe(false);
  });
});
