// Model planner. Returns a validated attack menu. It does not estimate effects
// and does not execute attacks. Keep the menu rules aligned with
// src/lib/falsify/planSchema.ts. The browser freezes the executable plan.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const KINDS = ['naive', 'placebo_shuffle', 'subset_stability', 'confounder_control', 'alternative_spec'];

const MENU_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rationale', 'attacks'],
  properties: {
    rationale: { type: 'string', maxLength: 400 },
    attacks: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'confounder'],
        properties: {
          kind: { type: 'string', enum: KINDS },
          confounder: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const SYSTEM = [
  'You choose an ordered menu of catalog attacks that try to falsify a stated association.',
  'You do not estimate effects, invent columns, or write code.',
  'The first attack must be naive.',
  'Include at least one of placebo_shuffle, subset_stability, confounder_control, alternative_spec.',
  'Prefer confounder_control when a confounder column is plausible.',
  'Set confounder to a listed column only on confounder_control. Otherwise set it to null.',
  'The rationale is a planner note, not a verdict, and must stay under 400 characters.',
].join(' ');

type MenuAttack = { kind: string; confounder: string | null };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identifier(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(value);
}

function validateMenu(attacks: MenuAttack[]): string | null {
  if (attacks.length < 2 || attacks.length > 5) return 'The model menu must contain 2 to 5 attacks.';
  if (attacks[0]?.kind !== 'naive') return 'The first attack must be naive.';
  const seen = new Set<string>();
  for (const attack of attacks) {
    if (!KINDS.includes(attack.kind)) return `Unknown attack "${attack.kind}".`;
    if (seen.has(attack.kind)) return `Duplicate attack "${attack.kind}".`;
    seen.add(attack.kind);
  }
  if (![...seen].some((kind) => kind !== 'naive')) return 'The menu must include a robustness attack.';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    return json(500, {
      error: 'Supabase function environment is incomplete. SUPABASE_URL and SUPABASE_ANON_KEY must be injected.',
    });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return json(401, { error: 'Sign in is required. An anon key is not a user.' });
  }

  const apiKey = Deno.env.get('XAI_API_KEY');
  if (!apiKey) {
    return json(503, {
      error: 'XAI_API_KEY is not configured. Add it in server secrets. The deterministic planner does not need it.',
    });
  }

  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return json(400, { error: 'The request body could not be read.' });
  }
  if (raw.length > 20000) return json(413, { error: 'Request is too large.' });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Request body must be JSON.' });
  }
  if (!isRecord(body)) return json(400, { error: 'Request body must be an object.' });

  const columns = Array.isArray(body.columns) ? body.columns.filter((item): item is string => typeof item === 'string') : [];
  if (columns.length < 2 || columns.length > 24 || columns.some((name) => !identifier(name))) {
    return json(400, { error: 'Send 2 to 24 column names. Each name must start with a letter.' });
  }
  const unique = new Set(columns);
  if (unique.size !== columns.length) return json(400, { error: 'Column names must be unique.' });

  const rowCount = body.rowCount;
  if (typeof rowCount !== 'number' || !Number.isInteger(rowCount) || rowCount < 8 || rowCount > 5000) {
    return json(400, { error: 'rowCount must be an integer from 8 to 5000.' });
  }
  const statement = typeof body.statement === 'string' ? body.statement.trim() : '';
  if (!statement || statement.length > 500) return json(400, { error: 'Write a claim of at most 500 characters.' });
  const outcome = typeof body.outcome === 'string' ? body.outcome : '';
  const predictor = typeof body.predictor === 'string' ? body.predictor : '';
  const direction = body.direction;
  if (!columns.includes(outcome) || !columns.includes(predictor) || outcome === predictor) {
    return json(400, { error: 'Outcome and predictor must be different listed columns.' });
  }
  if (direction !== 'positive' && direction !== 'negative' && direction !== 'nonzero') {
    return json(400, { error: 'Direction must be positive, negative, or nonzero.' });
  }
  const confounder = body.confounder;
  if (confounder !== null && (typeof confounder !== 'string' || !columns.includes(confounder))) {
    return json(400, { error: 'The named confounder must be a listed column or null.' });
  }
  const autoConfounder = body.autoConfounder;
  if (autoConfounder !== null && (typeof autoConfounder !== 'string' || !columns.includes(autoConfounder))) {
    return json(400, { error: 'autoConfounder must be a listed column or null.' });
  }
  const seed = body.seed;
  const alpha = body.alpha;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    return json(400, { error: 'Seed must be an integer from 0 to 2147483647.' });
  }
  if (typeof alpha !== 'number' || !(alpha >= 0.001 && alpha <= 0.2)) {
    return json(400, { error: 'Alpha must be between 0.001 and 0.2.' });
  }

  const reserved = await supabase.rpc('reserve_planner_call');
  if (reserved.error) return json(500, { error: 'The planner quota could not be reserved.' });
  const reservation = reserved.data;
  if (!isRecord(reservation) || reservation.ok !== true) {
    const message = isRecord(reservation) && typeof reservation.error === 'string'
      ? reservation.error
      : 'The planner quota refused this call.';
    return json(429, { error: message });
  }

  let providerStatus = 0;
  try {
    const provider = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4.7',
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              statement,
              outcome,
              predictor,
              direction,
              namedConfounder: confounder,
              suggestedConfounder: autoConfounder,
              columns,
              rowCount,
            }),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'attack_menu', strict: true, schema: MENU_SCHEMA },
        },
      }),
    });
    providerStatus = provider.status;
    if (!provider.ok) {
      await supabase.rpc('release_planner_call');
      const hint = provider.status === 401
        ? 'api.x.ai rejected XAI_API_KEY.'
        : `The planner request to api.x.ai failed (${provider.status}).`;
      return json(502, { error: hint });
    }
    let payload: unknown;
    try {
      payload = await provider.json();
    } catch {
      return json(422, { error: 'The model reply was not JSON. No attack was run.' });
    }
    const content = isRecord(payload)
      && Array.isArray(payload.choices)
      && isRecord(payload.choices[0])
      && isRecord(payload.choices[0].message)
      ? payload.choices[0].message.content
      : null;
    let parsed: unknown;
    try {
      parsed = typeof content === 'string' ? JSON.parse(content) : content;
    } catch {
      return json(422, { error: 'The model reply was not a menu. No attack was run.' });
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.attacks) || typeof parsed.rationale !== 'string') {
      return json(422, { error: 'The model reply was not a menu. No attack was run.' });
    }
    if (parsed.rationale.length > 400) {
      return json(422, { error: 'The planner note is longer than 400 characters. No attack was run.' });
    }
    const attacks: MenuAttack[] = [];
    for (const item of parsed.attacks) {
      if (!isRecord(item) || typeof item.kind !== 'string') {
        return json(422, { error: 'The model reply contained an unusable attack. No attack was run.' });
      }
      if (item.confounder !== null && typeof item.confounder !== 'string') {
        return json(422, { error: 'A confounder must be a column name or null. No attack was run.' });
      }
      attacks.push({ kind: item.kind, confounder: item.confounder });
    }
    const menuError = validateMenu(attacks);
    if (menuError) return json(422, { error: `${menuError} No attack was run.` });
    return json(200, {
      attacks,
      rationale: parsed.rationale.trim(),
      usage: { calls: reservation.calls, limit: reservation.limit },
      seed,
      alpha,
    });
  } catch {
    await supabase.rpc('release_planner_call');
    const hint = providerStatus === 0
      ? 'The planner request to api.x.ai did not complete.'
      : `The planner request to api.x.ai failed (${providerStatus}).`;
    return json(502, { error: hint });
  }
});
