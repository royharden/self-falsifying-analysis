import { aggregateAttempts } from '../falsify/aggregate';
import type { ModelAttack } from '../falsify/planSchema';
import type { AnalysisRun, AttemptResult, ClaimSpec, FrozenPlan } from '../falsify/types';
import { isAttackKind } from '../falsify/types';
import { asDirection, asTable, isRecord, type AnalysisRecord, type Origin } from '../record';
import { supabase } from '../supabase';

export type RemoteSummary = {
  id: string;
  verdict: string;
  statement: string;
  createdAt: string;
  isShared: boolean;
};

export type PlannerMenu = {
  attacks: ModelAttack[];
  rationale: string;
};

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function asPlan(value: unknown): FrozenPlan | null {
  if (!isRecord(value) || !Array.isArray(value.programs)) return null;
  if (value.planner !== 'deterministic' && value.planner !== 'llm') return null;
  if (typeof value.seed !== 'number' || typeof value.alpha !== 'number') return null;
  if (typeof value.placeboReplicates !== 'number') return null;
  return value as FrozenPlan;
}

function asAttempt(value: unknown): AttemptResult | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || !isAttackKind(value.kind)) return null;
  if (typeof value.ordinal !== 'number' || !isRecord(value.program)) return null;
  const estimate = value.estimate;
  const pValue = value.p_value ?? value.pValue;
  return {
    ordinal: value.ordinal,
    kind: value.kind,
    program: value.program as AttemptResult['program'],
    sourceText: typeof value.source_text === 'string' ? value.source_text : String(value.sourceText ?? ''),
    estimate: typeof estimate === 'number' ? estimate : null,
    standardError: typeof value.standard_error === 'number' ? value.standard_error : null,
    pValue: typeof pValue === 'number' ? pValue : null,
    n: typeof value.n === 'number' ? value.n : 0,
    degreesOfFreedom: typeof value.degrees_of_freedom === 'number' ? value.degrees_of_freedom : null,
    supportsClaim: value.supports_claim === true || value.supportsClaim === true,
    undermines: value.undermines === true,
    reason: typeof value.reason === 'string' ? value.reason : '',
    details: isRecord(value.details) ? (value.details as AttemptResult['details']) : {},
    error: typeof value.error === 'string' ? value.error : null,
  };
}

function claimFrom(value: unknown): ClaimSpec | null {
  if (!isRecord(value)) return null;
  const direction = asDirection(value.direction);
  if (!direction || typeof value.statement !== 'string') return null;
  if (typeof value.outcome_column !== 'string' || typeof value.predictor_column !== 'string') return null;
  return {
    statement: value.statement,
    outcome: value.outcome_column,
    predictor: value.predictor_column,
    direction,
    confounder: typeof value.confounder === 'string' ? value.confounder : null,
  };
}

export function recordFromParts(parts: {
  id: string;
  createdAt: string;
  datasetName: string;
  origin: Origin;
  table: TableLike;
  claim: ClaimSpec;
  plan: FrozenPlan;
  attempts: AttemptResult[];
  verdict: AnalysisRun['verdict'];
  summary: string;
  fisherP: number | null;
  eProduct: number | null;
  eProductCapped: boolean;
  saved: boolean;
  shareToken: string | null;
  isShared: boolean;
}): AnalysisRecord | null {
  const table = asTable(parts.table.columns, parts.table.rows);
  if (!table) return null;
  const attempts = [...parts.attempts].sort((left, right) => left.ordinal - right.ordinal);
  const stats = aggregateAttempts(attempts);
  const run: AnalysisRun = {
    plan: parts.plan,
    attempts,
    verdict: parts.verdict,
    fisherP: parts.fisherP ?? stats.fisherP,
    adjusted: stats.adjusted,
    eProduct: parts.eProduct ?? stats.eProduct,
    eProductCapped: parts.eProductCapped || stats.eProductCapped,
    summary: parts.summary,
  };
  return {
    id: parts.id,
    createdAt: parts.createdAt,
    datasetName: parts.datasetName,
    origin: parts.origin,
    table,
    claim: parts.claim,
    run,
    saved: parts.saved,
    shareToken: parts.shareToken,
    isShared: parts.isShared,
  };
}

type TableLike = { columns: unknown; rows: unknown };

function one(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function isVerdict(value: unknown): value is AnalysisRun['verdict'] {
  return value === 'survived' || value === 'falsified' || value === 'unsupported';
}

function isOrigin(value: unknown): value is Origin {
  return value === 'upload' || value === 'demo' || value === 'generated';
}

export async function listRemote(): Promise<{ ok: true; rows: RemoteSummary[] } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { data, error } = await supabase
    .from('analyses')
    .select('id, verdict, summary, created_at, is_shared, claims(statement)')
    .order('created_at', { ascending: false });
  if (error) return { ok: false, error: error.message };
  const rows: RemoteSummary[] = [];
  for (const row of data ?? []) {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.verdict !== 'string') continue;
    const claimRow = one(row.claims);
    const claim = isRecord(claimRow) && typeof claimRow.statement === 'string' ? claimRow.statement : 'Saved claim';
    rows.push({
      id: row.id,
      verdict: row.verdict,
      statement: claim,
      createdAt: typeof row.created_at === 'string' ? row.created_at : '',
      isShared: row.is_shared === true,
    });
  }
  return { ok: true, rows };
}

export async function loadRemote(id: string): Promise<{ ok: true; record: AnalysisRecord } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { data, error } = await supabase
    .from('analyses')
    .select('*, claims(*), datasets(*), attempts(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data || !isRecord(data)) return { ok: false, error: 'That run was not found.' };
  return mapJoined(data, true);
}

export async function loadShared(token: string): Promise<{ ok: true; record: AnalysisRecord } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured, so share links cannot be loaded.' };
  const { data, error } = await supabase.rpc('get_shared_analysis', { p_token: token });
  if (error) return { ok: false, error: error.message };
  if (!isRecord(data)) return { ok: false, error: 'This share link is not active.' };
  const analysis = data.analysis;
  const dataset = data.dataset;
  const claim = claimFrom(data.claim);
  const plan = isRecord(analysis) ? asPlan(analysis.plan) : null;
  if (!isRecord(analysis) || !isRecord(dataset) || !claim || !plan || !isVerdict(analysis.verdict)) {
    return { ok: false, error: 'This share link is not active.' };
  }
  const attempts = Array.isArray(data.attempts)
    ? data.attempts.map(asAttempt).filter((attempt): attempt is AttemptResult => attempt !== null)
    : [];
  const record = recordFromParts({
    id: typeof analysis.id === 'string' ? analysis.id : token,
    createdAt: typeof analysis.created_at === 'string' ? analysis.created_at : '',
    datasetName: typeof dataset.name === 'string' ? dataset.name : 'Shared table',
    origin: isOrigin(dataset.origin) ? dataset.origin : 'upload',
    table: { columns: dataset.columns, rows: dataset.rows },
    claim,
    plan,
    attempts,
    verdict: analysis.verdict,
    summary: typeof analysis.summary === 'string' ? analysis.summary : '',
    fisherP: typeof analysis.fisher_p === 'number' ? analysis.fisher_p : null,
    eProduct: typeof analysis.descriptive_e_product === 'number' ? analysis.descriptive_e_product : null,
    eProductCapped: analysis.e_product_capped === true,
    saved: true,
    shareToken: token,
    isShared: true,
  });
  if (!record) return { ok: false, error: 'The shared table could not be read.' };
  return { ok: true, record };
}

function mapJoined(data: Record<string, unknown>, saved: boolean): { ok: true; record: AnalysisRecord } | { ok: false; error: string } {
  const claim = claimFrom(one(data.claims));
  const datasetValue = one(data.datasets);
  const dataset = isRecord(datasetValue) ? datasetValue : null;
  const plan = asPlan(data.plan);
  if (!claim || !dataset || !plan || typeof data.id !== 'string' || !isVerdict(data.verdict)) {
    return { ok: false, error: 'The saved run is missing its plan or table.' };
  }
  const attempts = Array.isArray(data.attempts)
    ? data.attempts.map(asAttempt).filter((attempt): attempt is AttemptResult => attempt !== null)
    : [];
  const record = recordFromParts({
    id: data.id,
    createdAt: typeof data.created_at === 'string' ? data.created_at : '',
    datasetName: typeof dataset.name === 'string' ? dataset.name : 'Saved table',
    origin: isOrigin(dataset.origin) ? dataset.origin : 'upload',
    table: { columns: dataset.columns, rows: dataset.rows },
    claim,
    plan,
    attempts,
    verdict: data.verdict,
    summary: typeof data.summary === 'string' ? data.summary : '',
    fisherP: typeof data.fisher_p === 'number' ? data.fisher_p : null,
    eProduct: typeof data.descriptive_e_product === 'number' ? data.descriptive_e_product : null,
    eProductCapped: data.e_product_capped === true,
    saved,
    shareToken: typeof data.share_token === 'string' ? data.share_token : null,
    isShared: data.is_shared === true,
  });
  if (!record) return { ok: false, error: 'The saved table could not be read.' };
  return { ok: true, record };
}

export async function saveAnalysis(record: AnalysisRecord): Promise<{ ok: true; record: AnalysisRecord } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { ok: false, error: 'Sign in before saving a run.' };
  const ownerId = userData.user.id;
  const { data: dataset, error: datasetError } = await supabase
    .from('datasets')
    .insert({
      owner_id: ownerId,
      name: record.datasetName.slice(0, 120),
      columns: record.table.columns,
      rows: record.table.rows,
      row_count: record.table.rows.length,
      origin: record.origin,
    })
    .select('id')
    .single();
  if (datasetError || !dataset) return { ok: false, error: datasetError?.message ?? 'The table could not be saved.' };

  const { data: claim, error: claimError } = await supabase
    .from('claims')
    .insert({
      owner_id: ownerId,
      dataset_id: dataset.id,
      statement: record.claim.statement.trim().slice(0, 500),
      outcome_column: record.claim.outcome,
      predictor_column: record.claim.predictor,
      direction: record.claim.direction,
      confounder: record.claim.confounder,
    })
    .select('id')
    .single();
  if (claimError || !claim) {
    await supabase.from('datasets').delete().eq('id', dataset.id);
    return { ok: false, error: claimError?.message ?? 'The claim could not be saved.' };
  }

  const shareToken = newToken();
  const { data: analysis, error: analysisError } = await supabase
    .from('analyses')
    .insert({
      owner_id: ownerId,
      claim_id: claim.id,
      dataset_id: dataset.id,
      planner: record.run.plan.planner,
      seed: record.run.plan.seed,
      alpha: record.run.plan.alpha,
      status: 'complete',
      verdict: record.run.verdict,
      attempt_count: record.run.attempts.length,
      summary: record.run.summary.slice(0, 2000),
      plan: record.run.plan,
      fisher_p: record.run.fisherP,
      descriptive_e_product: record.run.eProduct,
      e_product_capped: record.run.eProductCapped,
      share_token: shareToken,
      is_shared: false,
    })
    .select('id')
    .single();
  if (analysisError || !analysis) {
    await supabase.from('datasets').delete().eq('id', dataset.id);
    return { ok: false, error: analysisError?.message ?? 'The run could not be saved.' };
  }

  const { error: attemptError } = await supabase.from('attempts').insert(
    record.run.attempts.map((attempt) => ({
      analysis_id: analysis.id,
      owner_id: ownerId,
      ordinal: attempt.ordinal,
      kind: attempt.kind,
      program: attempt.program,
      source_text: attempt.sourceText.slice(0, 4000),
      estimate: attempt.estimate,
      standard_error: attempt.standardError,
      p_value: attempt.pValue,
      n: attempt.n,
      degrees_of_freedom: attempt.degreesOfFreedom,
      supports_claim: attempt.supportsClaim,
      undermines: attempt.undermines,
      reason: attempt.reason.slice(0, 500),
      details: attempt.details,
      error: attempt.error,
    })),
  );
  if (attemptError) {
    await supabase.from('analyses').delete().eq('id', analysis.id);
    await supabase.from('datasets').delete().eq('id', dataset.id);
    return { ok: false, error: attemptError.message };
  }

  return {
    ok: true,
    record: { ...record, id: analysis.id, saved: true, shareToken, isShared: false },
  };
}

export async function setShared(id: string, isShared: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { error } = await supabase.from('analyses').update({ is_shared: isShared }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function saveCampaign(report: {
  seed: number;
  replicates: number;
  rowsPerCase: number;
  scores: Record<string, number>;
  cases: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { ok: false, error: 'Sign in before saving a bench report.' };
  const { error } = await supabase.from('eval_campaigns').insert({
    owner_id: userData.user.id,
    seed: report.seed,
    replicates: report.replicates,
    rows_per_case: report.rowsPerCase,
    scores: report.scores,
    cases: report.cases,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function requestModelMenu(body: {
  columns: string[];
  rowCount: number;
  statement: string;
  outcome: string;
  predictor: string;
  direction: string;
  confounder: string | null;
  autoConfounder: string | null;
  seed: number;
  alpha: number;
}): Promise<{ ok: true; menu: PlannerMenu } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: 'Supabase is not configured. The deterministic planner does not need it.' };
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { ok: false, error: 'Sign in before asking the model to choose attacks.' };
  const { data, error } = await supabase.functions.invoke('plan-attacks', { body });
  if (error) {
    const message = await readInvokeError(error);
    return { ok: false, error: message ?? 'The model planner failed. No attack was run.' };
  }
  if (!isRecord(data) || !Array.isArray(data.attacks) || typeof data.rationale !== 'string') {
    return { ok: false, error: 'The model planner returned an unusable menu. No attack was run.' };
  }
  const attacks: ModelAttack[] = [];
  for (const item of data.attacks) {
    if (!isRecord(item) || typeof item.kind !== 'string') {
      return { ok: false, error: 'The model planner returned an unusable menu. No attack was run.' };
    }
    if (item.confounder !== null && typeof item.confounder !== 'string') {
      return { ok: false, error: 'The model planner returned an unusable menu. No attack was run.' };
    }
    attacks.push({ kind: item.kind, confounder: item.confounder });
  }
  return { ok: true, menu: { attacks, rationale: data.rationale } };
}

async function readInvokeError(error: unknown): Promise<string | null> {
  if (!isRecord(error) || !('context' in error)) return null;
  const context = error.context;
  if (!(context instanceof Response)) return null;
  try {
    const body: unknown = await context.json();
    if (isRecord(body) && typeof body.error === 'string') return body.error;
  } catch {
    return null;
  }
  return null;
}
