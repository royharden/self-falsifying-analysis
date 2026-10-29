# Deferred validation

Everything below is **unverified**. The source was built under Dirty Mode (static checks only, 2026-10-23). Each row says what still has to happen before the behaviour can be called working.

| Area | Not yet verified | Check to run when activation is authorized |
| --- | --- | --- |
| Install / packaging | No `node_modules`, **no lockfile**; `@types/node`, `vite-node` newly listed | `npm install` (creates the lockfile), then `npm ci`; licence check of pinned dependencies |
| Type/build | Typechecked only with scratch stubs for React, Vite, Supabase, Node and Deno | `npm run typecheck`, `npm run build`; `deno check supabase/functions/plan-attacks/index.ts` |
| Unit/contract tests | `tests/*.test.ts` authored, never executed | `npm test`; fix failures rather than editing expectations, except where an expectation is shown wrong by an independent reference |
| Numerics | t quantile, OLS/FWL SE/df, Cook's D, ranks, permutation | Compare fixtures with an independent statistics package (e.g. R `lm`, `qt`), including scale/near-collinear cases |
| Demo transitions | Confounded demo → challenged, real-effect companion → not challenged (expected from the generator equations, never observed) | Run both in a browser; record the actual intervals; no numbers are written into the UI by hand |
| Browser worker | 10 s per-recipe deadline, load deadline, cancel/timeout, 1 MiB / 5000×24 limit, responsiveness | Largest-input run, forced timeout, cancel mid-run, reload mid-run (interrupted) in Chrome, Firefox, Safari |
| Replay / export | Kernel digest stability (build vs `vite-node`), tolerance, `run.json` round trip | Fresh-session rerun of local, saved and shared records; diff report on a hand-tampered export |
| Migration | `20261023140000_init.sql` never applied; no target inspected | Inspect the Bolt Database ledger first (BOLT-HANDOFF), apply once to a fresh target, confirm extension `pgcrypto` in `extensions` |
| RLS / grants | Owner-only select, no direct writes, column-limited share select, PUBLIC execute revoked | Two real users + anon: cross-user reads denied, direct insert/update/delete denied, `get_shared_analysis` returns only the projection |
| Immutability / atomicity | Guard triggers, idempotent retries, changed-payload conflict, all-or-nothing `save_local_analysis` | Fault-inject mid-save; retry with the same and a changed payload; attempt updates/deletes as owner |
| Sharing / deletion | One immutable snapshot, raw token returned once, revoke, no re-enable, privacy delete with shared parents | Create/open signed-out/revoke/reopen; delete an analysis whose dataset another analysis uses |
| Planner quota | reserve → dispatched → terminal, cap 24 per UTC day, original-day release, no release after dispatch, concurrency | Direct-RPC denial for users, two concurrent invocations with one request id, cap at 24, pre-dispatch release on the original day |
| Planner provider | xAI endpoint, `response_format` json_schema, `max_tokens`, model id, 20 s timeout, gateway JWT with `verify_jwt = true` | One separately authorized bounded call; record actual usage; confirm unauthenticated and unverified users are refused |
| Auth | Signup confirmation, login, PKCE recovery with the hash router, logout, redirect allowlist | Configure Site URL/redirects for the hosted origin; walk every flow |
| Benchmark | No results; development and held-out splits never run | `npm run eval -- --split development`, review, freeze constants, then held-out once; publish only `eval/results/` numbers |
| Planner arm | Scoring interface only | Separately authorized bounded campaign, if ever |
