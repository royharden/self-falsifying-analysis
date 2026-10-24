# Bolt handoff

**Status: construction complete, runtime unverified.** Source built under a Dirty Mode construction run (2026-10-23); nothing has been installed, built, applied, deployed or called. Do not treat this as deployment-ready. Repository: this folder, local git `main`. Code revision: `c6dbaf1` (all code packages); docs land in the commit after it. There is **no remote**: creating one, pushing or importing into Bolt is a separate step that needs Roy's explicit authorization.

## Target

- **Bolt Database** (Supabase-compatible Postgres, Auth and Edge Functions). No separate Supabase project, Storage bucket, Realtime publication, scheduler, queue or external worker.
- Static frontend (Vite build output `dist/`, hash routing, no server rewrites needed).

## Migration — inspect before applying

There is exactly one migration: `supabase/migrations/20261023140000_init.sql` (requires `pgcrypto`, created in schema `extensions`; private helpers in schema `s19_private`).

1. Inspect the chosen target's migration ledger and schema with authorized tooling.
2. If version `20261023140000` has **never** been applied anywhere: apply this file once to the empty target.
3. If any target already applied the older Grok draft of this file (git commit `54bc816`): do **not** apply the new file there. Restore the old bytes for that target's history and write ordered forward migrations to reach this schema. Never infer history from table existence, never replay uncertain SQL, never replace a populated connection.

## Schema and API contract

Tables: `datasets`, `claims`, `analyses`, `analysis_executions`, `attempts`, `analysis_shares`, `planner_usage`, `planner_requests`, `eval_campaigns`. RLS is enabled on all nine. Authenticated owners may SELECT their own rows in six of them: `datasets`, `claims`, `analyses`, `analysis_executions`, `attempts`, `eval_campaigns`, plus the visibility columns of their own `analysis_shares` rows. `planner_usage` and `planner_requests` have **no direct access at all** (no grants to anon or authenticated, no policies, by design); they are reached only through `get_planner_usage` and the service-role quota RPCs — do not add policies to them. No direct writes for anyone; guard triggers keep evidence immutable.

| RPC | Grantee |
| --- | --- |
| `freeze_protocol`, `append_attempts`, `complete_analysis`, `save_local_analysis`, `start_rerun`, `complete_rerun`, `set_analysis_share`, `delete_analysis`, `get_planner_usage`, `save_eval_campaign` | `authenticated` |
| `get_shared_analysis(token)` | `anon`, `authenticated` |
| `reserve_planner_call`, `mark_planner_dispatched`, `finish_planner_call` | `service_role` only |

## Edge function `plan-attacks`

- Files: `supabase/functions/plan-attacks/index.ts` and `contract.ts` (keep together; `index.ts` imports `./contract.ts`). Imports `https://esm.sh/@supabase/supabase-js@2.57.4`.
- `supabase/config.toml`: `verify_jwt = true`. The handler also calls `auth.getUser()` and requires a confirmed email. Verify the target gateway's actual JWT/key behaviour at deployment.
- Secrets: `XAI_API_KEY`, `ANALYSIS_LLM_MODEL` (choose a model id that exists at deployment; none is assumed). Platform-injected: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (used only for the three quota RPCs; never exposed or logged).
- Missing key/model → 503 without charging a slot.

## Frontend configuration

- Public env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Without them the app runs in local guided mode.
- Auth: email/password; set Site URL and the redirect allowlist to the hosted origin including `#/` and `#/reset` (PKCE flow). Confirmation emails required for the paid planner.

## Operational notes

- Deleting an `auth.users` row fails while that user owns analyses (guarded immutable evidence); run `delete_analysis` for each analysis first.
- Known gaps are listed in `DEVELOPMENT-STATUS.md`.

## Build

`npm install` (creates the lockfile — commit it), `npm run typecheck`, `npm test`, `npm run build`. None of these has run yet.

## Checks

- Passed: no-emit TypeScript over app, tests, scripts and the edge function with scratch type stubs; per-package static review by separate reviewer agents.
- Not run: everything in `DEFERRED-VALIDATION.md`.

## Suggested Bolt prompt (inspection only — authorizes no apply, deploy, publish or paid call)

> Inspect this repository and the connected Bolt Database without changing anything. Report: whether migration version `20261023140000` (or an older file with that version) appears in the migration ledger, and whether the database is empty; which secrets the `plan-attacks` function would need (`XAI_API_KEY`, `ANALYSIS_LLM_MODEL`); and the verbatim results of `npm install`, `npm run typecheck`, `npm test` and `npm run build`. Do not apply migrations, deploy functions, publish or deploy the site, or make any model call.

## Later provisioning step (requires Roy's explicit approval first)

Only after the inspection report and an explicit go-ahead: apply `20261023140000_init.sql` once to the verified-empty target, deploy `plan-attacks` with `verify_jwt = true`, enter the secrets, set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, and configure Auth redirects. Publishing the site remains a further, separate decision.
