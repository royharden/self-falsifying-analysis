// plan-attacks: metadata-only planner (PLAN.md section 8). Deno entrypoint; all rules live in
// contract.ts. verify_jwt = true in config.toml, and the handler still calls auth.getUser():
// a public project key alone never authorizes a paid call. The service-role client is used only
// for the three service-only quota RPCs, after the user is verified, and is never returned or logged.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  handlePlan,
  MAX_OUTPUT_TOKENS,
  PROMPT_VERSION,
  PROPOSAL_SCHEMA,
  PROVIDER_TIMEOUT_MS,
  PROVIDER_URL,
  SYSTEM_PROMPT,
  userPrompt,
  type ModelReply,
  type PlanRequest,
  type ReserveOutcome,
} from './contract.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Existing xAI adapter shape behind a small seam: fixed endpoint, server-configured model. */
async function callModel(request: PlanRequest, apiKey: string, model: string): Promise<ModelReply> {
  const response = await fetch(PROVIDER_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(request) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'planner_proposal', strict: true, schema: PROPOSAL_SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(`provider status ${response.status}`);
  const payload = (await response.json()) as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
  let content: unknown = null;
  try {
    content = typeof message?.content === 'string' ? JSON.parse(message.content) : null;
  } catch {
    content = null; // An unparseable reply fails validation; nothing is repaired.
  }
  const usage = payload.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    content,
    // Only provider-reported counts; absent counts stay unknown.
    usage: usage ? { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens } : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond(405, { error: 'Use POST.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return respond(503, { error: 'The function environment is incomplete.' });

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return respond(400, { error: 'The request body could not be read.' });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const result = await handlePlan(bodyText, {
    getUser: async () => {
      const { data, error } = await userClient.auth.getUser();
      if (error || !data.user) return null;
      return { id: data.user.id, emailConfirmed: Boolean(data.user.email_confirmed_at) };
    },
    apiKey: Deno.env.get('XAI_API_KEY'),
    model: Deno.env.get('ANALYSIS_LLM_MODEL'),
    reserve: async (ownerId, requestId, hash) => {
      const { data, error } = await service.rpc('reserve_planner_call', { p_owner: ownerId, p_request_id: requestId, p_input_hash: hash });
      if (error) throw new Error('reserve failed');
      return data as ReserveOutcome;
    },
    markDispatched: async (ownerId, reservationId) => {
      const { data, error } = await service.rpc('mark_planner_dispatched', { p_owner: ownerId, p_reservation_id: reservationId });
      if (error) throw new Error('dispatch acknowledgement failed');
      return data === true;
    },
    finish: async (ownerId, reservationId, status, proposal, usage, latencyMs, errorCode) => {
      const { error } = await service.rpc('finish_planner_call', {
        p_owner: ownerId,
        p_reservation_id: reservationId,
        p_status: status,
        p_proposal: proposal,
        p_model: Deno.env.get('ANALYSIS_LLM_MODEL') ?? null,
        p_prompt_version: PROMPT_VERSION,
        p_usage: usage,
        p_latency_ms: latencyMs,
        p_error_code: errorCode,
      });
      if (error) throw new Error('finish failed');
    },
    callModel,
    now: () => Date.now(),
  });
  if (result.status >= 500) console.error(`plan-attacks ${result.status}`); // status only: no prompts, rows or keys
  return respond(result.status, result.body);
});
