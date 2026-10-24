import { describe, expect, it } from 'vitest';
import { handlePlan, parseRequest, type Deps, type PlanRequest, type Proposal } from '../supabase/functions/plan-attacks/contract';

// All provider and database effects are stubs. No test can reach a network or a paid API:
// callModel is injected, and the default stub throws unless a test supplies a reply.

const request: PlanRequest = {
  requestId: '6f1c2a4e-1b2c-4d3e-8f90-123456789abc',
  catalogueVersion: 1,
  claim: { statement: 'More hours raise scores.', x: 'hours', y: 'score', direction: 'positive', delta: 0.5, units: 'points per hour' },
  columns: [
    { id: 'hours', label: 'Hours', type: 'numeric' },
    { id: 'score', label: 'Score', type: 'numeric' },
    { id: 'prior', label: 'Prior score', type: 'numeric', timeRelation: 'measured before the workshop' },
  ],
  rowCount: 200,
};
const body = JSON.stringify(request);

const proposal: Proposal = {
  primaryCovariate: 'prior',
  abstained: false,
  rationale: 'Measured before exposure; plausibly drives both.',
  secondary: [
    { kind: 'influence', note: 'a' },
    { kind: 'rank_sensitivity', note: 'b' },
    { kind: 'predictor_permutation', note: 'c' },
  ],
};

type Log = string[];

function deps(log: Log, overrides: Partial<Deps> = {}): Deps {
  return {
    getUser: async () => ({ id: 'owner-1', emailConfirmed: true }),
    apiKey: 'test-key-not-real',
    model: 'test-model',
    reserve: async (owner, id) => {
      log.push(`reserve:${owner}:${id}`);
      return { outcome: 'reserved', reservation_id: 'r1', charged: 1, limit: 24 };
    },
    markDispatched: async () => {
      log.push('dispatched');
      return true;
    },
    finish: async (_owner, _reservation, status, _proposal, _usage, _latency, errorCode) => {
      log.push(`finish:${status}:${errorCode ?? ''}`);
    },
    callModel: async () => {
      log.push('call');
      throw new Error('no network in tests');
    },
    now: () => 0,
    ...overrides,
  };
}

describe('request contract', () => {
  it('rejects rows, statistics and unknown fields', () => {
    expect(parseRequest(JSON.stringify({ ...request, rows: [[1, 2]] })).ok).toBe(false);
    expect(parseRequest(JSON.stringify({ ...request, columns: [{ ...request.columns[0], mean: 3 }, ...request.columns.slice(1)] })).ok).toBe(false);
    expect(parseRequest(JSON.stringify({ ...request, rowCount: 39 })).ok).toBe(false);
    expect(parseRequest('x'.repeat(17 * 1024)).ok).toBe(false);
    expect(parseRequest(body).ok).toBe(true);
  });
});

describe('handler state machine', () => {
  it('401 without a user, 403 when the email is unconfirmed, before any reservation', async () => {
    const log: Log = [];
    expect((await handlePlan(body, deps(log, { getUser: async () => null }))).status).toBe(401);
    expect((await handlePlan(body, deps(log, { getUser: async () => ({ id: 'o', emailConfirmed: false }) }))).status).toBe(403);
    expect(log).toEqual([]);
  });

  it('400 on a bad body and 503 on missing setup, with no slot reserved', async () => {
    const log: Log = [];
    expect((await handlePlan('{}', deps(log))).status).toBe(400);
    expect((await handlePlan(body, deps(log, { apiKey: undefined }))).status).toBe(503);
    expect((await handlePlan(body, deps(log, { model: undefined }))).status).toBe(503);
    expect(log).toEqual([]);
  });

  it('uses the verified user id as owner, dispatches before calling, and completes once', async () => {
    const log: Log = [];
    const result = await handlePlan(body, deps(log, { callModel: async () => { log.push('call'); return { content: proposal, usage: { input_tokens: 10, output_tokens: 20 } }; } }));
    expect(result.status).toBe(200);
    expect(log).toEqual([`reserve:owner-1:${request.requestId}`, 'dispatched', 'call', 'finish:complete:']);
  });

  it('maps conflict 409, quota 429, cached 200 and pending 202 without calling the provider', async () => {
    const cases: [Deps['reserve'], number][] = [
      [async () => ({ outcome: 'conflict' }), 409],
      [async () => ({ outcome: 'quota_exhausted', limit: 24 }), 429],
      [async () => ({ outcome: 'cached', proposal, model: 'm', usage: null }), 200],
      [async () => ({ outcome: 'pending_or_unknown', status: 'dispatched' }), 202],
    ];
    for (const [reserve, status] of cases) {
      const log: Log = [];
      expect((await handlePlan(body, deps(log, { reserve }))).status).toBe(status);
      expect(log).not.toContain('call');
    }
  });

  it('never calls the provider when the dispatch acknowledgement is uncertain or refused', async () => {
    for (const markDispatched of [async () => { throw new Error('timeout'); }, async () => false]) {
      const log: Log = [];
      const result = await handlePlan(body, deps(log, { markDispatched }));
      expect(result.status).toBe(202);
      expect(log).not.toContain('call');
      expect(log.some((entry) => entry.startsWith('finish:released'))).toBe(false);
    }
  });

  it('keeps provider failure and invalid replies charged (502 / 422), never released or retried', async () => {
    const failed: Log = [];
    expect((await handlePlan(body, deps(failed))).status).toBe(502);
    expect(failed.filter((entry) => entry === 'call')).toHaveLength(1);
    expect(failed).toContain('finish:charged_failure:provider_error');

    const invalid: Log = [];
    const bad = { ...proposal, primaryCovariate: 'hours' };
    const result = await handlePlan(body, deps(invalid, { callModel: async () => ({ content: bad, usage: null }) }));
    expect(result.status).toBe(422);
    expect(invalid).toContain('finish:charged_failure:invalid_reply');
  });

  it('rejects abstention inconsistencies and non-permutations in replies', async () => {
    for (const content of [
      { ...proposal, abstained: true },
      { ...proposal, secondary: [proposal.secondary[0], proposal.secondary[0], proposal.secondary[2]] },
      { ...proposal, extra: 1 },
      'not json',
    ]) {
      const log: Log = [];
      expect((await handlePlan(body, deps(log, { callModel: async () => ({ content, usage: null }) }))).status).toBe(422);
    }
  });
});
