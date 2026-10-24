import { describe, expect, it } from 'vitest';
import { attemptFromTexts, attemptPayload, datasetPayload } from '../src/lib/api/persist';
import { sha256Text } from '../src/lib/falsify/canonical';
import { workshopFixture } from '../src/lib/falsify/generate';
import { validateAttempt } from '../src/lib/falsify/grounding';
import { buildProtocol, DEFAULT_SECONDARY_ORDER } from '../src/lib/falsify/planSchema';
import { runFull } from '../src/lib/falsify/runner';

// Wire-format contract between the browser and the SQL RPCs: the server hashes the exact
// canonical texts, so the hashes the browser computed must equal sha256 of those texts.
const fixture = workshopFixture('real');
const built = buildProtocol({
  table: fixture.table,
  dataset: fixture.dataset,
  claim: {
    statement: fixture.suggestion.statement,
    x: 'hours',
    y: 'final_score',
    covariate: { kind: 'none' },
    direction: 'positive',
    delta: 0.5,
    xUnits: 'hours',
    yUnits: 'points',
    iidAcknowledged: true,
  },
  seed: 1,
  permutations: 99,
  secondaryOrder: DEFAULT_SECONDARY_ORDER,
  engineSourceDigest: 'a'.repeat(64),
  parentAnalysisId: null,
});
if (!built.ok) throw new Error(built.errors.join('; '));
const attempts = runFull(fixture.table, built.protocol);

describe('persistence wire format', () => {
  it('sends a dataset text whose sha256 is the protocol dataset hash', () => {
    const payload = datasetPayload({ datasetName: 'demo', table: fixture.table, protocol: built.protocol, columns: fixture.columns });
    expect(payload.normalized_hash).toBe(built.protocol.dataset.normalizedHash);
    expect(sha256Text(payload.normalized_text)).toBe(payload.normalized_hash);
  });

  it('sends attempt texts whose hashes are the browser recipe and payload hashes', () => {
    for (const attempt of attempts) {
      const wire = attemptPayload(built.protocol, attempt);
      expect(wire.recipe_hash).toBe(attempt.recipeHash);
      expect(sha256Text(wire.terminal_text)).toBe(attempt.payloadHash);
    }
  });

  it('rebuilds attempts from stored texts that pass the grounding gate unchanged', () => {
    for (const attempt of attempts) {
      const wire = attemptPayload(built.protocol, attempt);
      const rebuilt = attemptFromTexts(attempt.ordinal, wire.recipe_text, wire.terminal_text);
      expect(rebuilt).toEqual(attempt);
      expect(validateAttempt(rebuilt, built.protocol)).toEqual([]);
    }
  });

  it('turns a tampered stored text into an attempt the gate rejects', () => {
    const wire = attemptPayload(built.protocol, attempts[0]);
    const tampered = wire.terminal_text.replace('"baseline_reproduced"', '"baseline_not_reproduced"');
    expect(validateAttempt(attemptFromTexts(0, wire.recipe_text, tampered), built.protocol).length).toBeGreaterThan(0);
  });
});
