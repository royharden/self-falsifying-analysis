-- S19 self-falsifying analysis: consolidated baseline schema (PLAN.md section 6).
--
-- Applies ONLY to a fresh Bolt Database whose migration ledger shows this version was never
-- applied. The earlier Grok draft of this file (git baseline 54bc816) was never applied to any
-- target according to the project records; before applying, inspect the target ledger. If any
-- target already ran the old draft, do NOT apply this file: keep the old bytes for that target and
-- add ordered forward migrations instead (see BOLT-HANDOFF.md).
--
-- Model: every write goes through SECURITY DEFINER RPCs with fixed search_path and explicit
-- auth checks. Authenticated owners may SELECT their own rows; anon and other users get nothing
-- except one shared projection by bearer token. Evidence rows are immutable; guard triggers
-- enforce it even for definer code. The database validates structure, identity and order, not
-- statistical correctness; client hashes are not proof of honest computation.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists s19_private;
revoke all on schema s19_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Private helpers

create or replace function s19_private.sha256_hex(p_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function s19_private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- Recipe kind by ordinal (canonical catalogue v1).
create or replace function s19_private.kind_of(p_ordinal integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['baseline_ols', 'adjusted_ols', 'influence', 'rank_sensitivity', 'predictor_permutation'])[p_ordinal + 1];
$$;

create or replace function s19_private.outcome_allowed(p_kind text, p_outcome text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'baseline_ols' then p_outcome in ('baseline_reproduced', 'baseline_not_reproduced', 'inconclusive', 'inapplicable', 'error', 'cancelled', 'interrupted')
    when 'adjusted_ols' then p_outcome in ('challenged_primary', 'retained_primary', 'inconclusive', 'inapplicable', 'error', 'cancelled', 'interrupted')
    when 'influence' then p_outcome in ('sensitivity_flag', 'no_flag', 'inapplicable', 'error', 'cancelled', 'interrupted')
    when 'rank_sensitivity' then p_outcome in ('sensitivity_flag', 'no_flag', 'inapplicable', 'error', 'cancelled', 'interrupted')
    when 'predictor_permutation' then p_outcome in ('no_flag', 'inapplicable', 'error', 'cancelled', 'interrupted')
    else false
  end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables

create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  source jsonb not null check (jsonb_typeof(source) = 'object' and octet_length(source::text) <= 65536),
  normalized_text text not null check (octet_length(normalized_text) <= 8388608),
  normalized_hash text not null check (normalized_hash ~ '^[0-9a-f]{64}$'),
  columns jsonb not null check (jsonb_typeof(columns) = 'array'),
  row_count integer not null check (row_count between 40 and 5000),
  col_count integer not null check (col_count between 2 and 24),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, normalized_hash)
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  dataset_id uuid not null,
  claim_text text not null check (octet_length(claim_text) <= 16384),
  claim_hash text not null check (claim_hash ~ '^[0-9a-f]{64}$'),
  statement text not null check (char_length(statement) between 1 and 2000),
  x text not null,
  y text not null,
  z text,
  direction text not null check (direction in ('positive', 'negative')),
  delta double precision not null check (delta > 0 and delta < 'infinity'::double precision),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, dataset_id, claim_hash),
  foreign key (dataset_id, owner_id) references public.datasets (id, owner_id)
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  dataset_id uuid not null,
  claim_id uuid not null,
  parent_analysis_id uuid,
  protocol_text text not null check (octet_length(protocol_text) <= 65536),
  protocol_hash text not null check (protocol_hash ~ '^[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version = 1),
  policy_id text not null check (policy_id = 's19-association-v1'),
  policy_version integer not null check (policy_version = 1),
  catalogue_version integer not null check (catalogue_version = 1),
  engine_version text not null check (char_length(engine_version) between 1 and 80),
  engine_source_digest text not null check (engine_source_digest ~ '^[0-9a-f]{64}$'),
  origin text not null check (origin in ('server_frozen', 'uploaded_after_execution')),
  server_received_at timestamptz not null default now(),
  client_frozen_at timestamptz,
  lifecycle text not null check (lifecycle in ('frozen', 'complete')),
  original_execution_id uuid,
  idempotency_key uuid not null,
  derived_headline text check (derived_headline is null or char_length(derived_headline) <= 40),
  derived_facts_hash text check (derived_facts_hash is null or derived_facts_hash ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  unique (id, owner_id),
  unique (owner_id, idempotency_key),
  foreign key (dataset_id, owner_id) references public.datasets (id, owner_id),
  foreign key (claim_id, owner_id) references public.claims (id, owner_id),
  foreign key (parent_analysis_id) references public.analyses (id) on delete set null
);

create table public.analysis_executions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  owner_id uuid not null,
  parent_execution_id uuid,
  scope text not null check (scope in ('full', 'rerun_one')),
  target_ordinal integer check (target_ordinal between 0 and 4),
  protocol_hash text not null check (protocol_hash ~ '^[0-9a-f]{64}$'),
  client_started_at timestamptz,
  client_ended_at timestamptz,
  server_received_at timestamptz not null default now(),
  lifecycle text not null check (lifecycle in ('running', 'completed', 'cancelled', 'interrupted')),
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array' and octet_length(events::text) <= 65536),
  finalized_at timestamptz,
  idempotency_key uuid,
  check ((scope = 'full' and target_ordinal is null) or (scope = 'rerun_one' and target_ordinal is not null)),
  check (client_started_at is null or client_started_at <= now() + interval '5 minutes'),
  check (client_ended_at is null or client_started_at is null or client_ended_at >= client_started_at),
  unique (id, analysis_id),
  unique (id, owner_id),
  unique (analysis_id, idempotency_key),
  foreign key (analysis_id, owner_id) references public.analyses (id, owner_id) on delete cascade,
  foreign key (parent_execution_id, analysis_id) references public.analysis_executions (id, analysis_id)
);

alter table public.analyses
  add constraint analyses_original_execution_fk
  foreign key (original_execution_id) references public.analysis_executions (id) deferrable initially deferred;

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  execution_id uuid not null,
  owner_id uuid not null,
  ordinal integer not null check (ordinal between 0 and 4),
  kind text not null,
  role text not null check (role in ('baseline', 'primary', 'secondary')),
  recipe_text text not null check (octet_length(recipe_text) <= 16384),
  recipe_hash text not null check (recipe_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null,
  reason_code text not null check (char_length(reason_code) between 1 and 80),
  terminal_text text not null check (octet_length(terminal_text) <= 131072),
  terminal_hash text not null check (terminal_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  unique (execution_id, ordinal),
  check (kind = s19_private.kind_of(ordinal)),
  check (s19_private.outcome_allowed(kind, outcome)),
  foreign key (execution_id, analysis_id) references public.analysis_executions (id, analysis_id) on delete cascade,
  foreign key (analysis_id, owner_id) references public.analyses (id, owner_id) on delete cascade
);

create table public.analysis_shares (
  analysis_id uuid primary key,
  owner_id uuid not null,
  original_execution_id uuid not null references public.analysis_executions (id),
  projection_text text not null check (octet_length(projection_text) <= 10485760),
  projection_hash text not null check (projection_hash ~ '^[0-9a-f]{64}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true,
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (analysis_id, owner_id) references public.analyses (id, owner_id) on delete cascade
);

create table public.planner_usage (
  owner_id uuid not null references auth.users (id) on delete cascade,
  reservation_day date not null,
  charged_slots integer not null default 0 check (charged_slots between 0 and 24),
  primary key (owner_id, reservation_day)
);

create table public.planner_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  reservation_day date not null,
  status text not null check (status in ('reserved', 'dispatched', 'complete', 'released', 'charged_failure')),
  proposal jsonb check (proposal is null or octet_length(proposal::text) <= 8192),
  model text check (model is null or char_length(model) <= 120),
  prompt_version text check (prompt_version is null or char_length(prompt_version) <= 40),
  usage jsonb check (usage is null or octet_length(usage::text) <= 2048),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 600000),
  error_code text check (error_code is null or char_length(error_code) <= 60),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  finished_at timestamptz,
  unique (owner_id, request_id)
);

create table public.eval_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  policy_id text not null,
  engine_version text not null,
  report_text text not null check (octet_length(report_text) <= 1048576),
  report_hash text not null check (report_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index datasets_owner_idx on public.datasets (owner_id, created_at desc);
create index claims_dataset_idx on public.claims (dataset_id);
create index analyses_owner_idx on public.analyses (owner_id, server_received_at desc);
create index analyses_parent_idx on public.analyses (parent_analysis_id);
create index analyses_claim_idx on public.analyses (claim_id);
create index executions_analysis_idx on public.analysis_executions (analysis_id);
create index executions_parent_idx on public.analysis_executions (parent_execution_id);
create index attempts_analysis_idx on public.attempts (analysis_id, ordinal);
create index planner_requests_owner_idx on public.planner_requests (owner_id, created_at desc);
create index eval_campaigns_owner_idx on public.eval_campaigns (owner_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Row level security: owners read their own rows; no direct writes for anyone.

alter table public.datasets enable row level security;
alter table public.claims enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_executions enable row level security;
alter table public.attempts enable row level security;
alter table public.analysis_shares enable row level security;
alter table public.planner_usage enable row level security;
alter table public.planner_requests enable row level security;
alter table public.eval_campaigns enable row level security;

revoke all on table
  public.datasets, public.claims, public.analyses, public.analysis_executions, public.attempts,
  public.analysis_shares, public.planner_usage, public.planner_requests, public.eval_campaigns
from public, anon, authenticated;

grant select on table
  public.datasets, public.claims, public.analyses, public.analysis_executions, public.attempts, public.eval_campaigns
to authenticated;
-- Shares: owners see visibility metadata only, never the token hash or projection via direct reads.
grant select (analysis_id, owner_id, original_execution_id, enabled, consent_at, created_at, revoked_at)
  on public.analysis_shares to authenticated;

create policy datasets_owner_select on public.datasets for select to authenticated using (owner_id = auth.uid());
create policy claims_owner_select on public.claims for select to authenticated using (owner_id = auth.uid());
create policy analyses_owner_select on public.analyses for select to authenticated using (owner_id = auth.uid());
create policy executions_owner_select on public.analysis_executions for select to authenticated using (owner_id = auth.uid());
create policy attempts_owner_select on public.attempts for select to authenticated using (owner_id = auth.uid());
create policy shares_owner_select on public.analysis_shares for select to authenticated using (owner_id = auth.uid());
create policy eval_owner_select on public.eval_campaigns for select to authenticated using (owner_id = auth.uid());
-- planner_usage and planner_requests: no policies; reachable only through get_planner_usage and service-role RPCs.

-- ---------------------------------------------------------------------------------------------
-- Guard triggers: immutable evidence and legal lifecycle transitions, even for definer code.
-- Deletion is allowed only inside delete_analysis, which sets s19.allow_delete for its transaction.

create or replace function s19_private.deny_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('s19.allow_delete', true) = 'on' then
    return old;
  end if;
  raise exception '% on % is not allowed: evidence is immutable', tg_op, tg_table_name using errcode = '42501';
end;
$$;

create trigger datasets_immutable before update or delete on public.datasets
  for each row execute function s19_private.deny_change();
create trigger claims_immutable before update or delete on public.claims
  for each row execute function s19_private.deny_change();
create trigger attempts_immutable before update or delete on public.attempts
  for each row execute function s19_private.deny_change();

create or replace function s19_private.guard_analysis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('s19.allow_delete', true) = 'on' then
      return old;
    end if;
    raise exception 'analyses can only be removed by delete_analysis' using errcode = '42501';
  end if;
  -- parent_analysis_id may only be cleared by the FK when a parent is deleted.
  if new.parent_analysis_id is distinct from old.parent_analysis_id
     and not (new.parent_analysis_id is null and current_setting('s19.allow_delete', true) = 'on') then
    raise exception 'parent_analysis_id is immutable' using errcode = '42501';
  end if;
  if (new.id, new.owner_id, new.dataset_id, new.claim_id, new.protocol_text, new.protocol_hash, new.schema_version,
      new.policy_id, new.policy_version, new.catalogue_version, new.engine_version, new.engine_source_digest,
      new.origin, new.server_received_at, new.client_frozen_at, new.idempotency_key)
     is distinct from
     (old.id, old.owner_id, old.dataset_id, old.claim_id, old.protocol_text, old.protocol_hash, old.schema_version,
      old.policy_id, old.policy_version, old.catalogue_version, old.engine_version, old.engine_source_digest,
      old.origin, old.server_received_at, old.client_frozen_at, old.idempotency_key) then
    raise exception 'frozen analysis inputs are immutable' using errcode = '42501';
  end if;
  if old.lifecycle = 'complete' then
    if (new.lifecycle, new.original_execution_id, new.derived_headline, new.derived_facts_hash, new.completed_at)
       is distinct from (old.lifecycle, old.original_execution_id, old.derived_headline, old.derived_facts_hash, old.completed_at) then
      raise exception 'a completed analysis is immutable' using errcode = '42501';
    end if;
  end if;
  if old.original_execution_id is not null and new.original_execution_id is distinct from old.original_execution_id then
    raise exception 'original_execution_id is set once' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger analyses_guard before update or delete on public.analyses
  for each row execute function s19_private.guard_analysis();

create or replace function s19_private.guard_execution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('s19.allow_delete', true) = 'on' then
      return old;
    end if;
    raise exception 'executions can only be removed by delete_analysis' using errcode = '42501';
  end if;
  if (new.id, new.analysis_id, new.owner_id, new.parent_execution_id, new.scope, new.target_ordinal, new.protocol_hash,
      new.server_received_at, new.idempotency_key)
     is distinct from
     (old.id, old.analysis_id, old.owner_id, old.parent_execution_id, old.scope, old.target_ordinal, old.protocol_hash,
      old.server_received_at, old.idempotency_key) then
    raise exception 'execution identity is immutable' using errcode = '42501';
  end if;
  -- client_started_at may be filled once (at finalization) but never rewritten.
  if old.client_started_at is not null and new.client_started_at is distinct from old.client_started_at then
    raise exception 'client_started_at is set once' using errcode = '42501';
  end if;
  if old.lifecycle <> 'running' then
    raise exception 'a finalized execution is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger executions_guard before update or delete on public.analysis_executions
  for each row execute function s19_private.guard_execution();

create or replace function s19_private.guard_share()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('s19.allow_delete', true) = 'on' then
      return old;
    end if;
    raise exception 'shares are revoked, not deleted' using errcode = '42501';
  end if;
  if (new.analysis_id, new.owner_id, new.original_execution_id, new.projection_text, new.projection_hash, new.token_hash,
      new.consent_at, new.created_at)
     is distinct from
     (old.analysis_id, old.owner_id, old.original_execution_id, old.projection_text, old.projection_hash, old.token_hash,
      old.consent_at, old.created_at) then
    raise exception 'the shared snapshot is immutable' using errcode = '42501';
  end if;
  if old.enabled = false and new.enabled = true then
    raise exception 'a revoked share cannot be re-enabled (token rotation is not supported)' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger shares_guard before update or delete on public.analysis_shares
  for each row execute function s19_private.guard_share();

-- ---------------------------------------------------------------------------------------------
-- Validation helpers used by the RPCs.

-- Validates a canonical dataset payload and returns (columns, row_count, col_count).
create or replace function s19_private.check_dataset(p_dataset jsonb)
returns table (cols jsonb, nrows integer, ncols integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := p_dataset->>'normalized_text';
  v_parsed jsonb;
  v_row jsonb;
begin
  if jsonb_typeof(p_dataset) <> 'object' or v_text is null or octet_length(v_text) > 8388608 then
    raise exception 'dataset payload is malformed' using errcode = '22023';
  end if;
  if s19_private.sha256_hex(v_text) <> (p_dataset->>'normalized_hash') then
    raise exception 'dataset hash does not match its canonical text' using errcode = '22023';
  end if;
  v_parsed := v_text::jsonb;
  if jsonb_typeof(v_parsed->'columns') <> 'array' or jsonb_typeof(v_parsed->'rows') <> 'array' then
    raise exception 'dataset text is not {columns, rows}' using errcode = '22023';
  end if;
  cols := v_parsed->'columns';
  ncols := jsonb_array_length(cols);
  nrows := jsonb_array_length(v_parsed->'rows');
  if ncols < 2 or ncols > 24 or nrows < 40 or nrows > 5000 then
    raise exception 'dataset is outside the 40-5000 rows / 2-24 columns limits' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(cols) c where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^[A-Za-z][A-Za-z0-9_]{0,40}$') then
    raise exception 'dataset column identifiers are invalid' using errcode = '22023';
  end if;
  if (select count(distinct c) from jsonb_array_elements_text(cols) c) <> ncols then
    raise exception 'dataset column identifiers repeat' using errcode = '22023';
  end if;
  for v_row in select r from jsonb_array_elements(v_parsed->'rows') r loop
    if jsonb_typeof(v_row) <> 'array' or jsonb_array_length(v_row) <> ncols
       or exists (select 1 from jsonb_array_elements(v_row) cell where jsonb_typeof(cell) <> 'number') then
      raise exception 'dataset rows must be numeric arrays of the column count' using errcode = '22023';
    end if;
  end loop;
  return next;
end;
$$;

-- Structural protocol checks; returns the parsed protocol.
create or replace function s19_private.check_protocol(p_text text, p_hash text, p_dataset_hash text, p_cols jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_p jsonb;
  v_claim jsonb;
  v_i integer;
begin
  if p_text is null or octet_length(p_text) > 65536 then
    raise exception 'protocol is missing or too large' using errcode = '22023';
  end if;
  if s19_private.sha256_hex(p_text) <> p_hash then
    raise exception 'protocol hash does not match its canonical text' using errcode = '22023';
  end if;
  v_p := p_text::jsonb;
  if (v_p->>'schemaVersion') is distinct from '1' or (v_p->>'policyId') is distinct from 's19-association-v1'
     or (v_p->>'policyVersion') is distinct from '1' or (v_p->>'catalogueVersion') is distinct from '1' then
    raise exception 'unsupported protocol version' using errcode = '22023';
  end if;
  if (v_p->'dataset'->>'normalizedHash') is distinct from p_dataset_hash then
    raise exception 'protocol is bound to a different dataset' using errcode = '22023';
  end if;
  if jsonb_typeof(v_p->'recipes') <> 'array' or jsonb_array_length(v_p->'recipes') <> 5 then
    raise exception 'protocol must list exactly five recipes' using errcode = '22023';
  end if;
  for v_i in 0..4 loop
    if (v_p->'recipes'->v_i->>'ordinal') is distinct from v_i::text
       or (v_p->'recipes'->v_i->>'kind') is distinct from s19_private.kind_of(v_i)
       or (v_p->'recipes'->v_i->>'inputHash') is distinct from p_dataset_hash then
      raise exception 'recipe % does not match its canonical ordinal or dataset', v_i using errcode = '22023';
    end if;
  end loop;
  v_claim := v_p->'claim';
  if jsonb_typeof(v_claim) <> 'object'
     or (v_claim->>'direction') not in ('positive', 'negative')
     or jsonb_typeof(v_claim->'delta') <> 'number' or (v_claim->>'delta')::double precision <= 0
     or char_length(coalesce(v_claim->>'statement', '')) not between 1 and 2000
     or (v_claim->>'iidAcknowledged') is distinct from 'true' then
    raise exception 'protocol claim is invalid' using errcode = '22023';
  end if;
  if not (p_cols ? (v_claim->>'x')) or not (p_cols ? (v_claim->>'y')) or (v_claim->>'x') = (v_claim->>'y')
     or (jsonb_typeof(v_claim->'z') <> 'null' and (not (p_cols ? (v_claim->>'z')) or (v_claim->>'z') in (v_claim->>'x', v_claim->>'y'))) then
    raise exception 'protocol claim columns are not distinct dataset columns' using errcode = '22023';
  end if;
  return v_p;
end;
$$;

-- Validates and inserts terminal attempts for an execution. Identical retries are idempotent;
-- a changed payload for an existing ordinal conflicts.
create or replace function s19_private.insert_attempts(
  p_owner uuid, p_analysis uuid, p_execution uuid, p_protocol jsonb, p_scope text, p_target integer, p_attempts jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_ordinal integer;
  v_terminal jsonb;
  v_existing public.attempts%rowtype;
  v_count integer := 0;
begin
  if jsonb_typeof(p_attempts) <> 'array' or jsonb_array_length(p_attempts) > 5 then
    raise exception 'attempts must be an array of at most five records' using errcode = '22023';
  end if;
  for v_item in select a from jsonb_array_elements(p_attempts) a loop
    if jsonb_typeof(v_item->'ordinal') <> 'number' then
      raise exception 'attempt ordinal is missing' using errcode = '22023';
    end if;
    v_ordinal := (v_item->>'ordinal')::integer;
    if v_ordinal < 0 or v_ordinal > 4 or (p_scope = 'rerun_one' and v_ordinal <> p_target) then
      raise exception 'attempt % is outside the execution scope', v_ordinal using errcode = '22023';
    end if;
    if (v_item->>'recipe_hash') is null or (v_item->>'terminal_hash') is null
       or s19_private.sha256_hex(v_item->>'recipe_text') is distinct from (v_item->>'recipe_hash')
       or (v_item->>'recipe_text')::jsonb is distinct from p_protocol->'recipes'->v_ordinal then
      raise exception 'attempt % is not bound to the frozen recipe', v_ordinal using errcode = '22023';
    end if;
    if octet_length(v_item->>'terminal_text') > 131072
       or s19_private.sha256_hex(v_item->>'terminal_text') is distinct from (v_item->>'terminal_hash') then
      raise exception 'attempt % terminal hash does not match its canonical text', v_ordinal using errcode = '22023';
    end if;
    v_terminal := (v_item->>'terminal_text')::jsonb;
    if not s19_private.outcome_allowed(s19_private.kind_of(v_ordinal), v_terminal->>'outcome') then
      raise exception 'attempt % outcome is not allowed for its recipe', v_ordinal using errcode = '22023';
    end if;
    if ((v_terminal->>'outcome') in ('inapplicable', 'error', 'cancelled', 'interrupted')) <> (jsonb_typeof(v_terminal->'payload') = 'null') then
      raise exception 'attempt % payload presence does not match its outcome', v_ordinal using errcode = '22023';
    end if;
    if jsonb_typeof(v_terminal->'payload') = 'object' and (v_terminal->'payload'->>'kind') is distinct from s19_private.kind_of(v_ordinal) then
      raise exception 'attempt % payload kind does not match its recipe', v_ordinal using errcode = '22023';
    end if;
    select * into v_existing from public.attempts where execution_id = p_execution and ordinal = v_ordinal;
    if found then
      if v_existing.terminal_hash is distinct from (v_item->>'terminal_hash') then
        raise exception 'attempt % already has a different terminal record', v_ordinal using errcode = '23505';
      end if;
      continue;
    end if;
    insert into public.attempts (analysis_id, execution_id, owner_id, ordinal, kind, role, recipe_text, recipe_hash, outcome, reason_code, terminal_text, terminal_hash)
    values (
      p_analysis, p_execution, p_owner, v_ordinal, s19_private.kind_of(v_ordinal),
      case v_ordinal when 0 then 'baseline' when 1 then 'primary' else 'secondary' end,
      v_item->>'recipe_text', v_item->>'recipe_hash', v_terminal->>'outcome', left(coalesce(v_terminal->>'reasonCode', 'unknown'), 80),
      v_item->>'terminal_text', v_item->>'terminal_hash'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Creates or reuses dataset, claim and analysis rows for a frozen protocol (shared by freeze and local save).
create or replace function s19_private.create_analysis(
  p_owner uuid, p_key uuid, p_dataset jsonb, p_protocol_text text, p_protocol_hash text,
  p_client_frozen_at timestamptz, p_origin text, p_parent uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_existing public.analyses%rowtype;
  v_cols jsonb;
  v_nrows integer;
  v_ncols integer;
  v_protocol jsonb;
  v_dataset uuid;
  v_claim uuid;
  v_claim_text text;
  v_analysis uuid;
begin
  select * into v_existing from public.analyses where owner_id = p_owner and idempotency_key = p_key;
  if found then
    if v_existing.protocol_hash <> p_protocol_hash or v_existing.origin <> p_origin then
      raise exception 'idempotency key reused with a different protocol' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  if char_length(coalesce(p_dataset->>'name', '')) not between 1 and 200 or jsonb_typeof(p_dataset->'source') <> 'object' then
    raise exception 'dataset name or source is invalid' using errcode = '22023';
  end if;
  select cols, nrows, ncols into v_cols, v_nrows, v_ncols from s19_private.check_dataset(p_dataset);
  v_protocol := s19_private.check_protocol(p_protocol_text, p_protocol_hash, p_dataset->>'normalized_hash', v_cols);
  if (v_protocol->'dataset'->>'rowCount')::integer <> v_nrows or (v_protocol->'dataset'->>'columnCount')::integer <> v_ncols then
    raise exception 'protocol row/column counts do not match the dataset' using errcode = '22023';
  end if;
  if p_client_frozen_at is not null and p_client_frozen_at > now() + interval '5 minutes' then
    raise exception 'client_frozen_at is in the future' using errcode = '22023';
  end if;
  if p_parent is not null and not exists (select 1 from public.analyses where id = p_parent and owner_id = p_owner) then
    raise exception 'parent analysis not found' using errcode = '22023';
  end if;
  if (v_protocol->>'parentAnalysisId') is distinct from p_parent::text then
    raise exception 'parentAnalysisId in the protocol does not match the parent link' using errcode = '22023';
  end if;

  insert into public.datasets (owner_id, name, source, normalized_text, normalized_hash, columns, row_count, col_count)
  values (p_owner, p_dataset->>'name', p_dataset->'source', p_dataset->>'normalized_text', p_dataset->>'normalized_hash', v_cols, v_nrows, v_ncols)
  on conflict (owner_id, normalized_hash) do nothing;
  select id into v_dataset from public.datasets where owner_id = p_owner and normalized_hash = p_dataset->>'normalized_hash';

  v_claim_text := (v_protocol->'claim')::text;
  insert into public.claims (owner_id, dataset_id, claim_text, claim_hash, statement, x, y, z, direction, delta)
  values (
    p_owner, v_dataset, v_claim_text, s19_private.sha256_hex(v_claim_text), v_protocol->'claim'->>'statement',
    v_protocol->'claim'->>'x', v_protocol->'claim'->>'y', v_protocol->'claim'->>'z',
    v_protocol->'claim'->>'direction', (v_protocol->'claim'->>'delta')::double precision
  )
  on conflict (owner_id, dataset_id, claim_hash) do nothing;
  select id into v_claim from public.claims
    where owner_id = p_owner and dataset_id = v_dataset and claim_hash = s19_private.sha256_hex(v_claim_text);

  insert into public.analyses (
    owner_id, dataset_id, claim_id, parent_analysis_id, protocol_text, protocol_hash, schema_version, policy_id,
    policy_version, catalogue_version, engine_version, engine_source_digest, origin, client_frozen_at, lifecycle, idempotency_key
  ) values (
    p_owner, v_dataset, v_claim, p_parent, p_protocol_text, p_protocol_hash, 1, 's19-association-v1', 1, 1,
    v_protocol->>'engineVersion', v_protocol->>'engineSourceDigest', p_origin, p_client_frozen_at, 'frozen', p_key
  ) returning id into v_analysis;
  return v_analysis;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- User RPCs

-- Server receipt of a frozen protocol before the browser dispatches any recipe.
create or replace function public.freeze_protocol(
  p_idempotency_key uuid, p_dataset jsonb, p_protocol_text text, p_protocol_hash text,
  p_client_frozen_at timestamptz, p_parent_analysis_id uuid, p_consent_private_upload boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
  v_analysis uuid;
  v_row public.analyses%rowtype;
  v_execution uuid;
begin
  if p_consent_private_upload is distinct from true then
    raise exception 'explicit consent to upload the rows privately is required' using errcode = '22023';
  end if;
  v_analysis := s19_private.create_analysis(v_owner, p_idempotency_key, p_dataset, p_protocol_text, p_protocol_hash,
                                            p_client_frozen_at, 'server_frozen', p_parent_analysis_id);
  select * into v_row from public.analyses where id = v_analysis;
  if v_row.original_execution_id is null then
    insert into public.analysis_executions (analysis_id, owner_id, scope, protocol_hash, lifecycle)
    values (v_analysis, v_owner, 'full', p_protocol_hash, 'running')
    returning id into v_execution;
    update public.analyses set original_execution_id = v_execution where id = v_analysis;
  else
    v_execution := v_row.original_execution_id;
  end if;
  return jsonb_build_object('analysis_id', v_analysis, 'execution_id', v_execution, 'protocol_hash', p_protocol_hash,
                            'server_received_at', v_row.server_received_at);
end;
$$;

create or replace function public.append_attempts(p_execution_id uuid, p_attempts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
  v_exec public.analysis_executions%rowtype;
  v_protocol jsonb;
  v_inserted integer;
begin
  select * into v_exec from public.analysis_executions where id = p_execution_id and owner_id = v_owner for update;
  if not found then
    raise exception 'execution not found' using errcode = '42501';
  end if;
  select protocol_text::jsonb into v_protocol from public.analyses where id = v_exec.analysis_id;
  v_inserted := s19_private.insert_attempts(v_owner, v_exec.analysis_id, v_exec.id, v_protocol, v_exec.scope, v_exec.target_ordinal, p_attempts);
  return jsonb_build_object('inserted', v_inserted);
end;
$$;

-- Finalizes an execution once. Every expected ordinal must have a terminal record (errors,
-- inapplicable, cancelled and interrupted records count; absence never counts as no_flag).
create or replace function s19_private.finalize_execution(
  p_owner uuid, p_execution uuid, p_status text, p_events jsonb, p_started timestamptz, p_ended timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_exec public.analysis_executions%rowtype;
  v_expected integer;
  v_have integer;
begin
  select * into v_exec from public.analysis_executions where id = p_execution and owner_id = p_owner for update;
  if not found then
    raise exception 'execution not found' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'cancelled', 'interrupted') then
    raise exception 'invalid terminal status' using errcode = '22023';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' or octet_length(p_events::text) > 65536 then
    raise exception 'events must be a bounded array' using errcode = '22023';
  end if;
  if v_exec.lifecycle <> 'running' then
    if v_exec.lifecycle = p_status then
      return;
    end if;
    raise exception 'execution is already finalized' using errcode = '23505';
  end if;
  v_expected := case v_exec.scope when 'full' then 5 else 1 end;
  select count(*) into v_have from public.attempts where execution_id = p_execution;
  if v_have <> v_expected then
    raise exception 'execution has % of % terminal records', v_have, v_expected using errcode = '22023';
  end if;
  update public.analysis_executions
     set lifecycle = p_status, events = p_events, client_ended_at = p_ended,
         client_started_at = coalesce(v_exec.client_started_at, p_started), finalized_at = now()
   where id = p_execution;
end;
$$;

create or replace function public.complete_analysis(
  p_analysis_id uuid, p_status text, p_events jsonb, p_client_started_at timestamptz, p_client_ended_at timestamptz,
  p_derived_headline text, p_derived_facts_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
  v_row public.analyses%rowtype;
begin
  select * into v_row from public.analyses where id = p_analysis_id and owner_id = v_owner for update;
  if not found then
    raise exception 'analysis not found' using errcode = '42501';
  end if;
  if v_row.lifecycle = 'complete' then
    if v_row.derived_headline is not distinct from p_derived_headline and v_row.derived_facts_hash is not distinct from p_derived_facts_hash then
      return jsonb_build_object('analysis_id', v_row.id, 'lifecycle', 'complete');
    end if;
    raise exception 'analysis is already complete with different derived values' using errcode = '23505';
  end if;
  if v_row.original_execution_id is null then
    raise exception 'analysis has no original execution' using errcode = '22023';
  end if;
  perform s19_private.finalize_execution(v_owner, v_row.original_execution_id, p_status, p_events, p_client_started_at, p_client_ended_at);
  update public.analyses
     set lifecycle = 'complete', derived_headline = left(p_derived_headline, 40), derived_facts_hash = p_derived_facts_hash, completed_at = now()
   where id = p_analysis_id;
  return jsonb_build_object('analysis_id', p_analysis_id, 'lifecycle', 'complete');
end;
$$;

-- Atomic upload of a bundle executed locally before any server receipt. Always labelled
-- uploaded_after_execution; it never claims an earlier server freeze.
create or replace function public.save_local_analysis(
  p_idempotency_key uuid, p_dataset jsonb, p_protocol_text text, p_protocol_hash text, p_client_frozen_at timestamptz,
  p_parent_analysis_id uuid, p_execution jsonb, p_attempts jsonb, p_derived_headline text, p_derived_facts_hash text,
  p_consent_private_upload boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
  v_analysis uuid;
  v_row public.analyses%rowtype;
  v_execution uuid;
begin
  if p_consent_private_upload is distinct from true then
    raise exception 'explicit consent to upload the rows privately is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_execution) <> 'object' then
    raise exception 'execution payload is malformed' using errcode = '22023';
  end if;
  v_analysis := s19_private.create_analysis(v_owner, p_idempotency_key, p_dataset, p_protocol_text, p_protocol_hash,
                                            p_client_frozen_at, 'uploaded_after_execution', p_parent_analysis_id);
  select * into v_row from public.analyses where id = v_analysis;
  if v_row.lifecycle = 'complete' then
    if v_row.derived_facts_hash is distinct from p_derived_facts_hash then
      raise exception 'idempotency key reused with different results' using errcode = '23505';
    end if;
    return jsonb_build_object('analysis_id', v_analysis, 'execution_id', v_row.original_execution_id, 'server_received_at', v_row.server_received_at);
  end if;
  -- The client's execution id is kept so fact identities computed before upload stay valid.
  insert into public.analysis_executions (id, analysis_id, owner_id, scope, protocol_hash, client_started_at, lifecycle)
  values ((p_execution->>'execution_id')::uuid, v_analysis, v_owner, 'full', p_protocol_hash,
          nullif(p_execution->>'client_started_at', '')::timestamptz, 'running')
  returning id into v_execution;
  update public.analyses set original_execution_id = v_execution where id = v_analysis;
  perform s19_private.insert_attempts(v_owner, v_analysis, v_execution, p_protocol_text::jsonb, 'full', null, p_attempts);
  perform s19_private.finalize_execution(v_owner, v_execution, p_execution->>'status', p_execution->'events', null,
                                         nullif(p_execution->>'client_ended_at', '')::timestamptz);
  update public.analyses
     set lifecycle = 'complete', derived_headline = left(p_derived_headline, 40), derived_facts_hash = p_derived_facts_hash, completed_at = now()
   where id = v_analysis;
  return jsonb_build_object('analysis_id', v_analysis, 'execution_id', v_execution, 'server_received_at', v_row.server_received_at);
end;
$$;

-- Owner-saved rerun: same frozen identity, linked to an existing execution of the same analysis.
create or replace function public.start_rerun(
  p_analysis_id uuid, p_parent_execution_id uuid, p_scope text, p_target_ordinal integer, p_execution_id uuid,
  p_client_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
  v_row public.analyses%rowtype;
  v_execution uuid;
begin
  select * into v_row from public.analyses where id = p_analysis_id and owner_id = v_owner;
  if not found or v_row.lifecycle <> 'complete' then
    raise exception 'only a complete owned analysis can be rerun' using errcode = '42501';
  end if;
  if not exists (select 1 from public.analysis_executions where id = p_parent_execution_id and analysis_id = p_analysis_id) then
    raise exception 'parent execution does not belong to this analysis' using errcode = '22023';
  end if;
  if p_scope not in ('full', 'rerun_one') or (p_scope = 'rerun_one' and (p_target_ordinal is null or p_target_ordinal not between 0 and 4))
     or (p_scope = 'full' and p_target_ordinal is not null) then
    raise exception 'invalid rerun scope' using errcode = '22023';
  end if;
  -- The client's execution id doubles as the idempotency key.
  select id into v_execution from public.analysis_executions where id = p_execution_id and analysis_id = p_analysis_id and owner_id = v_owner;
  if v_execution is null then
    insert into public.analysis_executions (id, analysis_id, owner_id, parent_execution_id, scope, target_ordinal, protocol_hash, client_started_at, lifecycle, idempotency_key)
    values (p_execution_id, p_analysis_id, v_owner, p_parent_execution_id, p_scope, p_target_ordinal, v_row.protocol_hash, p_client_started_at, 'running', p_execution_id)
    returning id into v_execution;
  end if;
  return jsonb_build_object('execution_id', v_execution);
end;
$$;

create or replace function public.complete_rerun(
  p_execution_id uuid, p_attempts jsonb, p_status text, p_events jsonb, p_client_ended_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
  v_exec public.analysis_executions%rowtype;
  v_protocol jsonb;
begin
  select * into v_exec from public.analysis_executions where id = p_execution_id and owner_id = v_owner;
  if not found or v_exec.parent_execution_id is null then
    raise exception 'rerun execution not found' using errcode = '42501';
  end if;
  select protocol_text::jsonb into v_protocol from public.analyses where id = v_exec.analysis_id;
  perform s19_private.insert_attempts(v_owner, v_exec.analysis_id, v_exec.id, v_protocol, v_exec.scope, v_exec.target_ordinal, p_attempts);
  perform s19_private.finalize_execution(v_owner, v_exec.id, p_status, p_events, null, p_client_ended_at);
  return jsonb_build_object('execution_id', v_exec.id);
end;
$$;

-- Public snapshot: built server-side from the stored complete original evidence. It contains
-- the full rows (explicit consent), the frozen protocol and the original execution only; no
-- owner id, email or planner metadata. Returns the raw bearer token once.
create or replace function public.set_analysis_share(p_analysis_id uuid, p_enable boolean, p_consent_full_rows boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
  v_row public.analyses%rowtype;
  v_share public.analysis_shares%rowtype;
  v_projection jsonb;
  v_projection_text text;
  v_token text;
begin
  select * into v_row from public.analyses where id = p_analysis_id and owner_id = v_owner;
  if not found then
    raise exception 'analysis not found' using errcode = '42501';
  end if;
  select * into v_share from public.analysis_shares where analysis_id = p_analysis_id for update;
  if p_enable is distinct from true then
    if found and v_share.enabled then
      update public.analysis_shares set enabled = false, revoked_at = now() where analysis_id = p_analysis_id;
    end if;
    return jsonb_build_object('enabled', false);
  end if;
  if found then
    if v_share.enabled then
      raise exception 'already shared; the raw token is only returned once' using errcode = '23505';
    end if;
    raise exception 'this share was revoked; token rotation is not supported' using errcode = '42501';
  end if;
  if p_consent_full_rows is distinct from true then
    raise exception 'explicit consent to publish the full rows is required' using errcode = '22023';
  end if;
  if v_row.lifecycle <> 'complete' or v_row.original_execution_id is null then
    raise exception 'only a complete analysis can be shared' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'projectionVersion', 1,
    'analysisId', v_row.id,
    'parentAnalysisId', v_row.parent_analysis_id,
    'datasetName', d.name,
    'datasetSource', d.source,
    'normalizedText', d.normalized_text,
    'protocolText', v_row.protocol_text,
    'protocolHash', v_row.protocol_hash,
    'origin', v_row.origin,
    'serverReceivedAt', v_row.server_received_at,
    'derivedHeadline', v_row.derived_headline,
    'derivedFactsHash', v_row.derived_facts_hash,
    'execution', jsonb_build_object(
      'executionId', e.id, 'lifecycle', e.lifecycle, 'events', e.events,
      'clientStartedAt', e.client_started_at, 'clientEndedAt', e.client_ended_at,
      'attempts', (select jsonb_agg(jsonb_build_object('ordinal', a.ordinal, 'recipeText', a.recipe_text, 'terminalText', a.terminal_text) order by a.ordinal)
                   from public.attempts a where a.execution_id = e.id)
    )
  )
  into v_projection
  from public.datasets d, public.analysis_executions e
  where d.id = v_row.dataset_id and e.id = v_row.original_execution_id;
  v_projection_text := v_projection::text;
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.analysis_shares (analysis_id, owner_id, original_execution_id, projection_text, projection_hash, token_hash, enabled, consent_at)
  values (p_analysis_id, v_owner, v_row.original_execution_id, v_projection_text, s19_private.sha256_hex(v_projection_text),
          s19_private.sha256_hex(v_token), true, now());
  return jsonb_build_object('enabled', true, 'token', v_token);
end;
$$;

create or replace function public.get_shared_analysis(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_token is null or char_length(p_token) not between 40 and 64 or p_token !~ '^[A-Za-z0-9_-]+$' then
    return null;
  end if;
  select projection_text into v_text from public.analysis_shares
   where token_hash = s19_private.sha256_hex(p_token) and enabled;
  if v_text is null then
    return null;
  end if;
  return v_text::jsonb;
end;
$$;

-- Owner privacy deletion: removes the share and the analysis evidence; datasets and claims go
-- only when no other owned analysis still references them. Child revisions keep their own
-- evidence; their parent link is cleared.
create or replace function public.delete_analysis(p_analysis_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
  v_row public.analyses%rowtype;
begin
  select * into v_row from public.analyses where id = p_analysis_id and owner_id = v_owner for update;
  if not found then
    raise exception 'analysis not found' using errcode = '42501';
  end if;
  perform set_config('s19.allow_delete', 'on', true);
  delete from public.analysis_shares where analysis_id = p_analysis_id;
  -- Cascades to this analysis's executions and attempts; child revisions get parent_analysis_id = null.
  delete from public.analyses where id = p_analysis_id;
  if not exists (select 1 from public.analyses where claim_id = v_row.claim_id) then
    delete from public.claims where id = v_row.claim_id;
  end if;
  if not exists (select 1 from public.analyses where dataset_id = v_row.dataset_id) then
    delete from public.claims where dataset_id = v_row.dataset_id;
    delete from public.datasets where id = v_row.dataset_id;
  end if;
  perform set_config('s19.allow_delete', 'off', true);
  return jsonb_build_object('deleted', p_analysis_id);
end;
$$;

create or replace function public.get_planner_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
begin
  return jsonb_build_object(
    'day', (now() at time zone 'utc')::date,
    'charged', coalesce((select charged_slots from public.planner_usage where owner_id = v_owner and reservation_day = (now() at time zone 'utc')::date), 0),
    'limit', 24,
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('status', r.status, 'model', r.model, 'usage', r.usage, 'latency_ms', r.latency_ms,
                                          'error_code', r.error_code, 'created_at', r.created_at) order by r.created_at desc)
        from (select * from public.planner_requests where owner_id = v_owner order by created_at desc limit 20) r
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_eval_campaign(p_manifest_hash text, p_policy_id text, p_engine_version text, p_report_text text, p_report_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := s19_private.require_user();
  v_id uuid;
begin
  if s19_private.sha256_hex(p_report_text) <> p_report_hash then
    raise exception 'report hash does not match its text' using errcode = '22023';
  end if;
  perform p_report_text::jsonb;
  insert into public.eval_campaigns (owner_id, manifest_hash, policy_id, engine_version, report_text, report_hash)
  values (v_owner, p_manifest_hash, left(p_policy_id, 80), left(p_engine_version, 80), p_report_text, p_report_hash)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Service-only planner quota state machine (PLAN.md 8.2). The edge function derives the owner
-- from auth.getUser() and calls these with the service role; ordinary users cannot.

create or replace function public.reserve_planner_call(p_owner uuid, p_request_id uuid, p_input_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_req public.planner_requests%rowtype;
  v_slots integer;
begin
  if p_owner is null or p_request_id is null or p_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid reservation request' using errcode = '22023';
  end if;
  insert into public.planner_usage (owner_id, reservation_day, charged_slots) values (p_owner, v_day, 0)
  on conflict (owner_id, reservation_day) do nothing;
  -- Row lock serializes this owner's reservations for the day.
  select charged_slots into v_slots from public.planner_usage where owner_id = p_owner and reservation_day = v_day for update;
  select * into v_req from public.planner_requests where owner_id = p_owner and request_id = p_request_id for update;
  if found then
    if v_req.input_hash <> p_input_hash then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    if v_req.status = 'complete' then
      return jsonb_build_object('outcome', 'cached', 'proposal', v_req.proposal, 'model', v_req.model, 'usage', v_req.usage);
    end if;
    return jsonb_build_object('outcome', 'pending_or_unknown', 'status', v_req.status);
  end if;
  if v_slots >= 24 then
    return jsonb_build_object('outcome', 'quota_exhausted', 'limit', 24);
  end if;
  update public.planner_usage set charged_slots = charged_slots + 1 where owner_id = p_owner and reservation_day = v_day;
  insert into public.planner_requests (owner_id, request_id, input_hash, reservation_day, status)
  values (p_owner, p_request_id, p_input_hash, v_day, 'reserved')
  returning * into v_req;
  return jsonb_build_object('outcome', 'reserved', 'reservation_id', v_req.id, 'charged', v_slots + 1, 'limit', 24);
end;
$$;

create or replace function public.mark_planner_dispatched(p_owner uuid, p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.planner_requests set status = 'dispatched', dispatched_at = now()
   where id = p_reservation_id and owner_id = p_owner and status = 'reserved';
  return found;
end;
$$;

create or replace function public.finish_planner_call(
  p_owner uuid, p_reservation_id uuid, p_status text, p_proposal jsonb, p_model text, p_prompt_version text,
  p_usage jsonb, p_latency_ms integer, p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.planner_requests%rowtype;
begin
  select * into v_req from public.planner_requests where id = p_reservation_id and owner_id = p_owner for update;
  if not found then
    raise exception 'reservation not found' using errcode = '22023';
  end if;
  if v_req.status in ('complete', 'released', 'charged_failure') then
    if v_req.status = p_status and v_req.proposal is not distinct from p_proposal and v_req.error_code is not distinct from p_error_code then
      return jsonb_build_object('status', v_req.status);
    end if;
    raise exception 'reservation already terminal with a different result' using errcode = '23505';
  end if;
  if p_status = 'released' then
    -- Only a confirmed pre-dispatch failure is released, against the original reservation day.
    if v_req.status <> 'reserved' then
      raise exception 'a dispatched call stays charged' using errcode = '22023';
    end if;
    update public.planner_usage set charged_slots = charged_slots - 1
     where owner_id = p_owner and reservation_day = v_req.reservation_day and charged_slots > 0;
  elsif p_status in ('complete', 'charged_failure') then
    if v_req.status <> 'dispatched' then
      raise exception 'only a dispatched call can finish as %', p_status using errcode = '22023';
    end if;
    if p_status = 'complete' and p_proposal is null then
      raise exception 'a complete call needs a validated proposal' using errcode = '22023';
    end if;
  else
    raise exception 'invalid terminal status' using errcode = '22023';
  end if;
  update public.planner_requests
     set status = p_status, proposal = case when p_status = 'complete' then p_proposal else null end,
         model = left(p_model, 120), prompt_version = left(p_prompt_version, 40), usage = p_usage,
         latency_ms = p_latency_ms, error_code = left(p_error_code, 60), finished_at = now()
   where id = p_reservation_id;
  return jsonb_build_object('status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Function privileges: revoke the PUBLIC default everywhere, then grant narrowly.

revoke all on all functions in schema s19_private from public, anon, authenticated;

revoke all on function public.freeze_protocol(uuid, jsonb, text, text, timestamptz, uuid, boolean) from public, anon;
revoke all on function public.append_attempts(uuid, jsonb) from public, anon;
revoke all on function public.complete_analysis(uuid, text, jsonb, timestamptz, timestamptz, text, text) from public, anon;
revoke all on function public.save_local_analysis(uuid, jsonb, text, text, timestamptz, uuid, jsonb, jsonb, text, text, boolean) from public, anon;
revoke all on function public.start_rerun(uuid, uuid, text, integer, uuid, timestamptz) from public, anon;
revoke all on function public.complete_rerun(uuid, jsonb, text, jsonb, timestamptz) from public, anon;
revoke all on function public.set_analysis_share(uuid, boolean, boolean) from public, anon;
revoke all on function public.delete_analysis(uuid) from public, anon;
revoke all on function public.get_planner_usage() from public, anon;
revoke all on function public.save_eval_campaign(text, text, text, text, text) from public, anon;
revoke all on function public.get_shared_analysis(text) from public;
revoke all on function public.reserve_planner_call(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_planner_dispatched(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_planner_call(uuid, uuid, text, jsonb, text, text, jsonb, integer, text) from public, anon, authenticated;

grant execute on function
  public.freeze_protocol(uuid, jsonb, text, text, timestamptz, uuid, boolean),
  public.append_attempts(uuid, jsonb),
  public.complete_analysis(uuid, text, jsonb, timestamptz, timestamptz, text, text),
  public.save_local_analysis(uuid, jsonb, text, text, timestamptz, uuid, jsonb, jsonb, text, text, boolean),
  public.start_rerun(uuid, uuid, text, integer, uuid, timestamptz),
  public.complete_rerun(uuid, jsonb, text, jsonb, timestamptz),
  public.set_analysis_share(uuid, boolean, boolean),
  public.delete_analysis(uuid),
  public.get_planner_usage(),
  public.save_eval_campaign(text, text, text, text, text)
to authenticated;
grant execute on function public.get_shared_analysis(text) to anon, authenticated;
grant execute on function
  public.reserve_planner_call(uuid, uuid, text),
  public.mark_planner_dispatched(uuid, uuid),
  public.finish_planner_call(uuid, uuid, text, jsonb, text, text, jsonb, integer, text)
to service_role;
-- service_role reaches s19_private helpers only through the definer functions above.
