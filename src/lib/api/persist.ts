/**
 * RPC-only persistence client (PLAN.md section 6). The browser never writes tables
 * directly; every load is revalidated by the grounding gate, and stored derived
 * values are compared, never trusted.
 */
import type { CampaignReport } from '../falsify/evaluate';
import type { ExecutionRecord, ExecutionStatus, ObservedEvent } from '../falsify/bundle';
import { canonicalHash, canonicalJson, sha256Text } from '../falsify/canonical';
import type { ColumnMeta } from '../falsify/generate';
import type { HeaderMapEntry, ProtocolV1, Table, TerminalAttempt } from '../falsify/types';
import type { AnalysisRecord, StoredDerived } from '../record';
import { isRecord } from '../record';
import { supabase } from '../supabase';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const notConfigured: Result<never> = { ok: false, error: 'The backend is not configured (local mode).' };

function failure(error: unknown, fallback: string): Result<never> {
  if (isRecord(error) && typeof error.message === 'string') return { ok: false, error: error.message };
  return { ok: false, error: fallback };
}

/* ------------------------------------------------------------------ */
/* Wire formats */

export function datasetPayload(record: Pick<AnalysisRecord, 'datasetName' | 'table' | 'protocol' | 'columns'>) {
  const text = canonicalJson({ columns: record.table.columns, rows: record.table.rows });
  return {
    name: record.datasetName.slice(0, 200),
    source: { identity: record.protocol.dataset.source, columnsMeta: record.columns },
    normalized_text: text,
    normalized_hash: sha256Text(text),
  };
}

export function attemptPayload(protocol: ProtocolV1, attempt: TerminalAttempt) {
  const recipeText = canonicalJson(protocol.recipes[attempt.ordinal]);
  return {
    ordinal: attempt.ordinal,
    recipe_text: recipeText,
    recipe_hash: sha256Text(recipeText),
    terminal_text: canonicalJson({ outcome: attempt.outcome, reasonCode: attempt.reasonCode, reason: attempt.reason, payload: attempt.payload }),
    terminal_hash: attempt.payloadHash,
  };
}

/** Rebuilds a terminal attempt from stored canonical texts. Shape is validated later by the grounding gate. */
export function attemptFromTexts(ordinal: number, recipeText: string, terminalText: string): TerminalAttempt | null {
  try {
    const recipe = JSON.parse(recipeText) as unknown;
    const terminal = JSON.parse(terminalText) as unknown;
    if (!isRecord(recipe) || !isRecord(terminal)) return null;
    return {
      ordinal,
      kind: recipe.kind as TerminalAttempt['kind'],
      role: recipe.role as TerminalAttempt['role'],
      recipeHash: sha256Text(recipeText),
      outcome: terminal.outcome as TerminalAttempt['outcome'],
      reasonCode: terminal.reasonCode as string,
      reason: terminal.reason as string,
      payload: terminal.payload as TerminalAttempt['payload'],
      payloadHash: sha256Text(terminalText),
    };
  } catch {
    return null;
  }
}

function statusOf(lifecycle: unknown): ExecutionStatus {
  return lifecycle === 'completed' || lifecycle === 'cancelled' || lifecycle === 'interrupted' ? lifecycle : 'running';
}

function tableFrom(text: string): Table | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
    return { columns: parsed.columns as string[], rows: parsed.rows as number[][] };
  } catch {
    return null;
  }
}

function sourceExtras(source: unknown): { columns: ColumnMeta[] | null; headerMap: HeaderMapEntry[] | null } {
  if (!isRecord(source)) return { columns: null, headerMap: null };
  const identity = source.identity;
  const headerMap = isRecord(identity) && Array.isArray(identity.headerMap) ? (identity.headerMap as HeaderMapEntry[]) : null;
  return { columns: Array.isArray(source.columnsMeta) ? (source.columnsMeta as ColumnMeta[]) : null, headerMap };
}

/* ------------------------------------------------------------------ */
/* Freeze with server receipt, then append and complete. */

export async function freezeOnServer(
  record: Pick<AnalysisRecord, 'datasetName' | 'table' | 'protocol' | 'protocolHash' | 'columns'>,
  idempotencyKey: string,
): Promise<Result<{ analysisId: string; executionId: string; serverReceivedAt: string }>> {
  if (!supabase) return notConfigured;
  const { data, error } = await supabase.rpc('freeze_protocol', {
    p_idempotency_key: idempotencyKey,
    p_dataset: datasetPayload(record),
    p_protocol_text: canonicalJson(record.protocol),
    p_protocol_hash: record.protocolHash,
    p_client_frozen_at: new Date().toISOString(),
    p_parent_analysis_id: record.protocol.parentAnalysisId,
    p_consent_private_upload: true,
  });
  if (error || !isRecord(data)) return failure(error, 'The server did not record the frozen protocol.');
  return {
    ok: true,
    value: { analysisId: String(data.analysis_id), executionId: String(data.execution_id), serverReceivedAt: String(data.server_received_at) },
  };
}

export async function appendAttempts(executionId: string, protocol: ProtocolV1, attempts: TerminalAttempt[]): Promise<Result<null>> {
  if (!supabase) return notConfigured;
  const { error } = await supabase.rpc('append_attempts', {
    p_execution_id: executionId,
    p_attempts: attempts.map((attempt) => attemptPayload(protocol, attempt)),
  });
  return error ? failure(error, 'Attempts were not appended.') : { ok: true, value: null };
}

export async function completeOnServer(
  analysisId: string,
  execution: ExecutionRecord,
  derived: StoredDerived | null,
): Promise<Result<null>> {
  if (!supabase) return notConfigured;
  const { error } = await supabase.rpc('complete_analysis', {
    p_analysis_id: analysisId,
    p_status: execution.status,
    p_events: execution.events,
    p_client_started_at: execution.startedAt,
    p_client_ended_at: execution.endedAt,
    p_derived_headline: derived?.headlineCode ?? null,
    p_derived_facts_hash: derived?.factsHash ?? null,
  });
  return error ? failure(error, 'The analysis was not finalized on the server.') : { ok: true, value: null };
}

/** Uploads a locally executed analysis atomically, labelled uploaded_after_execution. */
export async function saveLocal(record: AnalysisRecord, derived: StoredDerived, idempotencyKey: string): Promise<Result<AnalysisRecord>> {
  if (!supabase) return notConfigured;
  const execution = record.executions.find((item) => item.executionId === record.originalExecutionId);
  if (!execution || execution.status === 'running') return { ok: false, error: 'Only a finished original run can be saved.' };
  const { data, error } = await supabase.rpc('save_local_analysis', {
    p_idempotency_key: idempotencyKey,
    p_dataset: datasetPayload(record),
    p_protocol_text: canonicalJson(record.protocol),
    p_protocol_hash: record.protocolHash,
    p_client_frozen_at: record.createdAt,
    p_parent_analysis_id: record.protocol.parentAnalysisId,
    p_execution: {
      execution_id: execution.executionId,
      status: execution.status,
      events: execution.events,
      client_started_at: execution.startedAt,
      client_ended_at: execution.endedAt,
    },
    p_attempts: execution.attempts.map((attempt) => attemptPayload(record.protocol, attempt)),
    p_derived_headline: derived.headlineCode,
    p_derived_facts_hash: derived.factsHash,
    p_consent_private_upload: true,
  });
  if (error || !isRecord(data)) return failure(error, 'The analysis was not saved.');
  const analysisId = String(data.analysis_id);
  // Local reruns are not uploaded by this call; they stay local until saved individually.
  return {
    ok: true,
    value: {
      ...record,
      id: analysisId,
      executions: record.executions.map((item) => ({ ...item, analysisId })),
      persistence: { kind: 'saved', origin: 'uploaded_after_execution', serverReceivedAt: String(data.server_received_at) },
      storedDerived: derived,
      savedExecutionIds: [execution.executionId],
    },
  };
}

/** Saves one finished owner rerun linked to its parent execution. */
export async function saveRerun(record: AnalysisRecord, execution: ExecutionRecord): Promise<Result<null>> {
  if (!supabase) return notConfigured;
  if (execution.status === 'running' || !execution.parentExecutionId) return { ok: false, error: 'Only a finished rerun can be saved.' };
  const started = await supabase.rpc('start_rerun', {
    p_analysis_id: record.id,
    p_parent_execution_id: execution.parentExecutionId,
    p_scope: execution.scope.kind,
    p_target_ordinal: execution.scope.kind === 'rerun_one' ? execution.scope.ordinal : null,
    p_execution_id: execution.executionId,
    p_client_started_at: execution.startedAt,
  });
  if (started.error) return failure(started.error, 'The rerun was not registered.');
  const { error } = await supabase.rpc('complete_rerun', {
    p_execution_id: execution.executionId,
    p_attempts: execution.attempts.map((attempt) => attemptPayload(record.protocol, attempt)),
    p_status: execution.status,
    p_events: execution.events,
    p_client_ended_at: execution.endedAt,
  });
  return error ? failure(error, 'The rerun was not saved.') : { ok: true, value: null };
}

/* ------------------------------------------------------------------ */
/* Owner reads (RLS: own rows only). */

export type RemoteSummary = { id: string; statement: string; receivedAt: string; origin: string; lifecycle: string; derivedHeadline: string | null };

export async function listRemote(): Promise<Result<RemoteSummary[]>> {
  if (!supabase) return notConfigured;
  const analyses = await supabase
    .from('analyses')
    .select('id, claim_id, server_received_at, origin, lifecycle, derived_headline')
    .order('server_received_at', { ascending: false })
    .limit(50);
  if (analyses.error) return failure(analyses.error, 'Saved analyses could not be listed.');
  const rows = (analyses.data ?? []) as Record<string, unknown>[];
  const claimIds = [...new Set(rows.map((row) => String(row.claim_id)))];
  const claims = claimIds.length > 0 ? await supabase.from('claims').select('id, statement').in('id', claimIds) : { data: [], error: null };
  if (claims.error) return failure(claims.error, 'Claims could not be listed.');
  const statements = new Map(((claims.data ?? []) as Record<string, unknown>[]).map((row) => [String(row.id), String(row.statement)]));
  return {
    ok: true,
    value: rows.map((row) => ({
      id: String(row.id),
      statement: statements.get(String(row.claim_id)) ?? '',
      receivedAt: String(row.server_received_at),
      origin: String(row.origin),
      lifecycle: String(row.lifecycle),
      derivedHeadline: typeof row.derived_headline === 'string' ? row.derived_headline : null,
    })),
  };
}

export async function loadRemote(id: string): Promise<Result<AnalysisRecord>> {
  if (!supabase) return notConfigured;
  const analysis = await supabase.from('analyses').select('*').eq('id', id).maybeSingle();
  if (analysis.error) return failure(analysis.error, 'The analysis could not be loaded.');
  const row = analysis.data as Record<string, unknown> | null;
  if (!row) return { ok: false, error: 'No saved analysis with that id is visible to this account.' };
  const [dataset, executions, attempts, share] = await Promise.all([
    supabase.from('datasets').select('name, source, normalized_text').eq('id', String(row.dataset_id)).maybeSingle(),
    supabase.from('analysis_executions').select('*').eq('analysis_id', id).order('server_received_at'),
    supabase.from('attempts').select('execution_id, ordinal, recipe_text, terminal_text').eq('analysis_id', id),
    supabase.from('analysis_shares').select('enabled').eq('analysis_id', id).maybeSingle(),
  ]);
  const problem = dataset.error ?? executions.error ?? attempts.error ?? share.error;
  if (problem) return failure(problem, 'The analysis evidence could not be loaded.');
  const datasetRow = dataset.data as Record<string, unknown> | null;
  const table = datasetRow ? tableFrom(String(datasetRow.normalized_text)) : null;
  let protocol: ProtocolV1;
  try {
    protocol = JSON.parse(String(row.protocol_text)) as ProtocolV1;
  } catch {
    return { ok: false, error: 'The stored protocol is not valid JSON.' };
  }
  if (!table || !datasetRow) return { ok: false, error: 'The stored dataset is malformed.' };
  const attemptRows = (attempts.data ?? []) as Record<string, unknown>[];
  const executionRecords: ExecutionRecord[] = ((executions.data ?? []) as Record<string, unknown>[]).map((exec) => {
    const scope =
      exec.scope === 'rerun_one' ? { kind: 'rerun_one' as const, ordinal: Number(exec.target_ordinal) } : { kind: 'full' as const };
    const list = attemptRows
      .filter((item) => item.execution_id === exec.id)
      .map((item) => attemptFromTexts(Number(item.ordinal), String(item.recipe_text), String(item.terminal_text)))
      .filter((item): item is TerminalAttempt => item !== null)
      .sort((left, right) => left.ordinal - right.ordinal);
    return {
      executionId: String(exec.id),
      analysisId: id,
      parentExecutionId: typeof exec.parent_execution_id === 'string' ? exec.parent_execution_id : null,
      scope,
      protocolHash: String(exec.protocol_hash),
      origin: row.origin === 'server_frozen' ? 'server_frozen' : 'uploaded_after_execution',
      startedAt: typeof exec.client_started_at === 'string' ? exec.client_started_at : null,
      endedAt: typeof exec.client_ended_at === 'string' ? exec.client_ended_at : null,
      status: statusOf(exec.lifecycle),
      attempts: list,
      events: Array.isArray(exec.events) ? (exec.events as ObservedEvent[]) : [],
    };
  });
  const extras = sourceExtras(datasetRow.source);
  const shareRow = share.data as Record<string, unknown> | null;
  return {
    ok: true,
    value: {
      id,
      createdAt: String(row.server_received_at),
      datasetName: String(datasetRow.name),
      table,
      headerMap: extras.headerMap,
      columns: extras.columns,
      protocol,
      protocolHash: String(row.protocol_hash),
      originalExecutionId: typeof row.original_execution_id === 'string' ? row.original_execution_id : null,
      executions: executionRecords,
      persistence: {
        kind: 'saved',
        origin: row.origin === 'server_frozen' ? 'server_frozen' : 'uploaded_after_execution',
        serverReceivedAt: String(row.server_received_at),
      },
      share: shareRow ? { enabled: shareRow.enabled === true, token: null } : null,
      serverExecutionId: typeof row.original_execution_id === 'string' ? row.original_execution_id : null,
      storedDerived:
        typeof row.derived_headline === 'string' && typeof row.derived_facts_hash === 'string'
          ? { headlineCode: row.derived_headline, factsHash: row.derived_facts_hash }
          : null,
      savedExecutionIds: executionRecords.map((item) => item.executionId),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Sharing and deletion. */

export async function setShare(analysisId: string, enable: boolean, consentFullRows: boolean): Promise<Result<{ token: string | null }>> {
  if (!supabase) return notConfigured;
  const { data, error } = await supabase.rpc('set_analysis_share', {
    p_analysis_id: analysisId,
    p_enable: enable,
    p_consent_full_rows: consentFullRows,
  });
  if (error || !isRecord(data)) return failure(error, 'The share setting was not changed.');
  return { ok: true, value: { token: typeof data.token === 'string' ? data.token : null } };
}

/** Signed-out reader: one immutable projection by bearer token. */
export async function loadShared(token: string): Promise<Result<AnalysisRecord>> {
  if (!supabase) return notConfigured;
  const { data, error } = await supabase.rpc('get_shared_analysis', { p_token: token });
  if (error) return failure(error, 'The shared analysis could not be loaded.');
  if (!isRecord(data)) return { ok: false, error: 'This link is not valid or has been revoked.' };
  const table = typeof data.normalizedText === 'string' ? tableFrom(data.normalizedText) : null;
  const execution = data.execution;
  if (!table || !isRecord(execution) || typeof data.protocolText !== 'string') return { ok: false, error: 'The shared snapshot is malformed.' };
  let protocol: ProtocolV1;
  try {
    protocol = JSON.parse(data.protocolText) as ProtocolV1;
  } catch {
    return { ok: false, error: 'The shared protocol is not valid JSON.' };
  }
  const analysisId = String(data.analysisId);
  const attempts = (Array.isArray(execution.attempts) ? execution.attempts : [])
    .map((item: unknown) =>
      isRecord(item) && typeof item.recipeText === 'string' && typeof item.terminalText === 'string'
        ? attemptFromTexts(Number(item.ordinal), item.recipeText, item.terminalText)
        : null,
    )
    .filter((item: TerminalAttempt | null): item is TerminalAttempt => item !== null);
  const executionId = String(execution.executionId);
  const extras = sourceExtras(data.datasetSource);
  return {
    ok: true,
    value: {
      id: analysisId,
      createdAt: String(data.serverReceivedAt),
      datasetName: String(data.datasetName),
      table,
      headerMap: extras.headerMap,
      columns: extras.columns,
      protocol,
      // The protocol hash is recomputed from the shared text, not taken from the snapshot.
      protocolHash: sha256Text(data.protocolText),
      originalExecutionId: executionId,
      executions: [
        {
          executionId,
          analysisId,
          parentExecutionId: null,
          scope: { kind: 'full' },
          protocolHash: String(data.protocolHash),
          origin: data.origin === 'server_frozen' ? 'server_frozen' : 'uploaded_after_execution',
          startedAt: typeof execution.clientStartedAt === 'string' ? execution.clientStartedAt : null,
          endedAt: typeof execution.clientEndedAt === 'string' ? execution.clientEndedAt : null,
          status: statusOf(execution.lifecycle),
          attempts,
          events: Array.isArray(execution.events) ? (execution.events as ObservedEvent[]) : [],
        },
      ],
      persistence: { kind: 'shared_view' },
      share: null,
      serverExecutionId: null,
      storedDerived:
        typeof data.derivedHeadline === 'string' && typeof data.derivedFactsHash === 'string'
          ? { headlineCode: data.derivedHeadline, factsHash: data.derivedFactsHash }
          : null,
      savedExecutionIds: [],
    },
  };
}

export async function deleteRemote(analysisId: string): Promise<Result<null>> {
  if (!supabase) return notConfigured;
  const { error } = await supabase.rpc('delete_analysis', { p_analysis_id: analysisId });
  return error ? failure(error, 'The analysis was not deleted.') : { ok: true, value: null };
}

export async function saveCampaign(report: CampaignReport): Promise<Result<null>> {
  if (!supabase) return notConfigured;
  let text: string;
  try {
    text = canonicalJson(report);
  } catch {
    return { ok: false, error: 'The report contains non-finite values and was not saved.' };
  }
  const { error } = await supabase.rpc('save_eval_campaign', {
    p_manifest_hash: report.manifestHash,
    p_policy_id: report.policyId,
    p_engine_version: report.engineVersion,
    p_report_text: text,
    p_report_hash: sha256Text(text),
  });
  return error ? failure(error, 'The campaign snapshot was not saved.') : { ok: true, value: null };
}

/** Stable idempotency key per record and action so retries never double-save. */
export function idempotencyKeyFor(recordId: string, action: string): string {
  const hex = canonicalHash({ recordId, action }).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
