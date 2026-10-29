/**
 * Client for the optional metadata-only planner (PLAN.md section 8). The request is
 * validated with the same contract module the server uses; rows, value summaries and
 * statistics are never part of it.
 */
import { parseRequest, type PlanRequest, type Proposal } from '../../../supabase/functions/plan-attacks/contract';
import type { ColumnMeta } from '../falsify/generate';
import type { Direction, HeaderMapEntry } from '../falsify/types';
import { isRecord } from '../record';
import { supabase } from '../supabase';

export type PlannerOutcome =
  | { kind: 'proposal'; proposal: Proposal; model: string | null; cached: boolean; usage: unknown }
  | { kind: 'pending'; status: string }
  | { kind: 'error'; status: number | null; error: string };

export function buildPlannerRequest(input: {
  requestId: string;
  columns: string[];
  headerMap: HeaderMapEntry[] | null;
  columnsMeta: ColumnMeta[] | null;
  rowCount: number;
  statement: string;
  x: string;
  y: string;
  direction: Direction;
  delta: number;
  units: string;
}): { ok: true; request: PlanRequest; text: string } | { ok: false; error: string } {
  const request: PlanRequest = {
    requestId: input.requestId,
    catalogueVersion: 1,
    claim: { statement: input.statement.trim(), x: input.x, y: input.y, direction: input.direction, delta: input.delta, units: input.units.slice(0, 128) },
    columns: input.columns.map((id) => {
      const meta = input.columnsMeta?.find((item) => item.id === id);
      const source = input.headerMap?.find((item) => item.id === id)?.source;
      // Labels only: generator role metadata is ground truth and is never sent as a user note.
      return { id, label: (meta?.label ?? source ?? id).slice(0, 128), type: 'numeric' as const };
    }),
    rowCount: input.rowCount,
  };
  const text = JSON.stringify(request);
  const checked = parseRequest(text);
  if (!checked.ok) return { ok: false, error: checked.error };
  return { ok: true, request, text };
}

export async function requestProposal(text: string): Promise<PlannerOutcome> {
  if (!supabase) return { kind: 'error', status: null, error: 'The backend is not configured (local mode).' };
  const { data, error } = await supabase.functions.invoke('plan-attacks', {
    body: text,
    headers: { 'Content-Type': 'application/json' },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    let message = (error as { message?: string }).message ?? 'The planner call failed.';
    let status: number | null = null;
    if (context && typeof context.json === 'function') {
      status = context.status;
      try {
        const body = (await context.json()) as unknown;
        if (isRecord(body) && typeof body.error === 'string') message = body.error;
      } catch {
        // Keep the generic message.
      }
    }
    return { kind: 'error', status, error: message };
  }
  if (!isRecord(data)) return { kind: 'error', status: null, error: 'The planner returned no body.' };
  if (data.outcome === 'pending_or_unknown') return { kind: 'pending', status: String(data.status) };
  if (!isRecord(data.proposal)) return { kind: 'error', status: null, error: 'The planner returned no proposal.' };
  return {
    kind: 'proposal',
    proposal: data.proposal as unknown as Proposal,
    model: typeof data.model === 'string' ? data.model : null,
    cached: data.cached === true,
    usage: data.usage ?? null,
  };
}

export async function plannerUsage(): Promise<{ charged: number; limit: number } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_planner_usage');
  if (error || !isRecord(data)) return null;
  return { charged: Number(data.charged), limit: Number(data.limit) };
}
