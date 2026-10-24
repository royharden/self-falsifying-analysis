-- Self-falsifying analysis. Private logs, unlisted share read, planner quota.
-- Apply once on an empty Bolt Database. Do not replay after data exists.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  columns jsonb not null,
  rows jsonb not null,
  row_count integer not null check (row_count between 8 and 5000),
  origin text not null check (origin in ('upload', 'demo', 'generated')),
  created_at timestamptz not null default now(),
  constraint datasets_shape check (
    jsonb_typeof(columns) = 'array'
    and jsonb_typeof(rows) = 'array'
    and jsonb_array_length(rows) = row_count
  )
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  dataset_id uuid not null references public.datasets (id) on delete cascade,
  statement text not null check (char_length(statement) between 1 and 500),
  outcome_column text not null,
  predictor_column text not null,
  direction text not null check (direction in ('positive', 'negative', 'nonzero')),
  confounder text,
  created_at timestamptz not null default now(),
  constraint claims_columns_differ check (outcome_column <> predictor_column)
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  claim_id uuid not null references public.claims (id) on delete cascade,
  dataset_id uuid not null references public.datasets (id) on delete cascade,
  planner text not null check (planner in ('deterministic', 'llm')),
  seed integer not null check (seed >= 0),
  alpha double precision not null check (alpha >= 0.001 and alpha <= 0.2),
  status text not null check (status in ('complete', 'error')),
  verdict text not null check (verdict in ('survived', 'falsified', 'unsupported')),
  attempt_count integer not null check (attempt_count between 1 and 5),
  summary text not null check (char_length(summary) between 1 and 2000),
  plan jsonb not null,
  fisher_p double precision,
  descriptive_e_product double precision,
  e_product_capped boolean not null default false,
  share_token text unique,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  constraint analyses_share_token check (
    share_token is null or char_length(share_token) between 22 and 80
  ),
  constraint analyses_shared_requires_token check (is_shared = false or share_token is not null)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  ordinal integer not null check (ordinal >= 0 and ordinal < 5),
  kind text not null,
  program jsonb not null,
  source_text text not null check (char_length(source_text) between 1 and 4000),
  estimate double precision,
  standard_error double precision,
  p_value double precision,
  n integer not null check (n >= 0),
  degrees_of_freedom integer,
  supports_claim boolean not null,
  undermines boolean not null,
  reason text not null check (char_length(reason) between 1 and 500),
  details jsonb not null,
  error text,
  unique (analysis_id, ordinal)
);

create table public.eval_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  seed integer not null,
  replicates integer not null check (replicates between 1 and 20),
  rows_per_case integer not null check (rows_per_case between 40 and 2000),
  scores jsonb not null,
  cases jsonb not null,
  created_at timestamptz not null default now()
);

create table public.planner_usage (
  owner_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (owner_id, day)
);

create index datasets_owner_idx on public.datasets (owner_id, created_at desc);
create index claims_owner_idx on public.claims (owner_id);
create index analyses_owner_idx on public.analyses (owner_id, created_at desc);
create index attempts_analysis_idx on public.attempts (analysis_id, ordinal);
create index eval_campaigns_owner_idx on public.eval_campaigns (owner_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.datasets enable row level security;
alter table public.claims enable row level security;
alter table public.analyses enable row level security;
alter table public.attempts enable row level security;
alter table public.eval_campaigns enable row level security;
alter table public.planner_usage enable row level security;

revoke all on table public.planner_usage from anon, authenticated;

create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy datasets_all on public.datasets
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy claims_all on public.claims
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.datasets d
      where d.id = dataset_id and d.owner_id = auth.uid()
    )
  );

create policy analyses_select on public.analyses
  for select to authenticated using (owner_id = auth.uid());
create policy analyses_insert on public.analyses
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.claims c
      where c.id = claim_id and c.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.datasets d
      where d.id = dataset_id and d.owner_id = auth.uid()
    )
  );
create policy analyses_update on public.analyses
  for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.claims c
      where c.id = claim_id and c.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.datasets d
      where d.id = dataset_id and d.owner_id = auth.uid()
    )
  );
create policy analyses_delete on public.analyses
  for delete to authenticated using (owner_id = auth.uid());

create policy attempts_select on public.attempts
  for select to authenticated using (owner_id = auth.uid());
create policy attempts_insert on public.attempts
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.analyses a
      where a.id = analysis_id and a.owner_id = auth.uid()
    )
  );
create policy attempts_delete on public.attempts
  for delete to authenticated using (owner_id = auth.uid());

create policy eval_campaigns_all on public.eval_campaigns
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.get_shared_analysis(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_token is null or char_length(p_token) < 22 then
    return null;
  end if;
  select jsonb_build_object(
    'analysis', jsonb_build_object(
      'id', a.id,
      'planner', a.planner,
      'seed', a.seed,
      'alpha', a.alpha,
      'status', a.status,
      'verdict', a.verdict,
      'attempt_count', a.attempt_count,
      'summary', a.summary,
      'plan', a.plan,
      'fisher_p', a.fisher_p,
      'descriptive_e_product', a.descriptive_e_product,
      'e_product_capped', a.e_product_capped,
      'created_at', a.created_at
    ),
    'claim', jsonb_build_object(
      'statement', c.statement,
      'outcome_column', c.outcome_column,
      'predictor_column', c.predictor_column,
      'direction', c.direction,
      'confounder', c.confounder
    ),
    'dataset', jsonb_build_object(
      'name', d.name,
      'columns', d.columns,
      'rows', d.rows,
      'row_count', d.row_count,
      'origin', d.origin
    ),
    'attempts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'ordinal', t.ordinal,
          'kind', t.kind,
          'program', t.program,
          'source_text', t.source_text,
          'estimate', t.estimate,
          'standard_error', t.standard_error,
          'p_value', t.p_value,
          'n', t.n,
          'degrees_of_freedom', t.degrees_of_freedom,
          'supports_claim', t.supports_claim,
          'undermines', t.undermines,
          'reason', t.reason,
          'details', t.details,
          'error', t.error
        )
        order by t.ordinal
      )
      from public.attempts t
      where t.analysis_id = a.id
    ), '[]'::jsonb)
  )
  into result
  from public.analyses a
  join public.claims c on c.id = a.claim_id
  join public.datasets d on d.id = a.dataset_id
  where a.share_token = p_token
    and a.is_shared = true;
  return result;
end;
$$;

revoke all on function public.get_shared_analysis(text) from public;
grant execute on function public.get_shared_analysis(text) to anon, authenticated;

create or replace function public.reserve_planner_call()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (timezone('utc', now()))::date;
  lim integer := 24;
  current_calls integer;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in is required.');
  end if;
  insert into public.planner_usage (owner_id, day, calls)
  values (uid, today, 0)
  on conflict (owner_id, day) do nothing;
  select calls into current_calls
  from public.planner_usage
  where owner_id = uid and day = today
  for update;
  if current_calls >= lim then
    return jsonb_build_object(
      'ok', false,
      'error', 'Daily planner limit reached (24). The deterministic planner is still available.',
      'limit', lim,
      'calls', current_calls
    );
  end if;
  update public.planner_usage
  set calls = calls + 1
  where owner_id = uid and day = today;
  return jsonb_build_object('ok', true, 'limit', lim, 'calls', current_calls + 1);
end;
$$;

create or replace function public.release_planner_call()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (timezone('utc', now()))::date;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in is required.');
  end if;
  update public.planner_usage
  set calls = greatest(calls - 1, 0)
  where owner_id = uid and day = today;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reserve_planner_call() from public;
revoke all on function public.release_planner_call() from public;
grant execute on function public.reserve_planner_call() to authenticated;
grant execute on function public.release_planner_call() to authenticated;
