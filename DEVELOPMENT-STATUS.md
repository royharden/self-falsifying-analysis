# Development status

Construction run 2026-10-23/24 under **Dirty Mode** (static checks only), built from the project's promoted implementation plan (kept with the agent notes outside this repository). Every package below is **accepted for Dirty Mode construction — runtime unverified**.

| Package | Plan milestone | Commit | Static review |
| --- | --- | --- | --- |
| Baseline (Grok source preserved byte for byte) | — | `54bc816` | — |
| P1 engine core: CSV contract, canonical JSON/SHA-256, t quantile, OLS/FWL, five recipes, δ policy, protocol | M1 | `81d72c9` | returned once (test constant), then passed |
| P2 offline reader journey: demos, freeze, worker, grounding, facts, replay diff, exports, revisions | M1–M2 | `54f29bb` | passed |
| P4 seeded benchmark: manifest, arms, scorer, eval script, browser bench | M3 | `f201187` | returned once (planner scoring, scorer tests), then passed |
| P5 persistence, sharing, auth: migration, RPC client, server-frozen runs | M4 | `a11d805` | passed |
| P6 metadata-only planner and quota state machine | M5 | `c6dbaf1` | passed |
| P7 product docs and Bolt handoff | M6 | commit after `c6dbaf1` | returned once (handoff prompt scope, RLS wording), then passed |

(P3 was merged into P2.)

## What was checked

- No-emit TypeScript (strict, `noUnusedLocals/Parameters`) over `src/`, `tests/`, `scripts/` and the edge function, using an already-installed TypeScript and scratch type stubs for React, Vite, Supabase, Node, Vitest and Deno. Exit 0. Stubs are looser than the real typings, so real `npm run typecheck` may still report errors.
- Line-by-line static review of each package by a separate reviewer agent.

## What was not done

No install, lockfile, build, test run, browser session, Deno check, SQL parse/apply, deployment, push or provider call. See `DEFERRED-VALIDATION.md`.

## Known gaps (reviewed, deliberately left)

- Deleting a user from `auth.users` fails while they own data (immutable-evidence triggers); use `delete_analysis` per analysis first.
- A server-frozen run whose tab closed before completion stays `frozen`/`running` on the server; it shows as interrupted on reload and cannot be completed, shared or rerun-saved. Freeze again as a new analysis.
- A revision whose parent exists only in this browser cannot be saved (the server requires an owned parent); save the parent first. Saving a local parent changes its id.
- Saving the same table twice reuses the first dataset row (name and provenance of the first save).
- A planner request id whose reservation was released returns "pending/unknown"; start a new request.
- `start_rerun` returns an existing execution for a reused id without comparing scope.
- Cached planner replies report the current prompt version, not the stored one.
- Share links cannot be rotated; a revoked share cannot be re-enabled.
- Saved-analysis list shows stored labels; opening a record recomputes the headline.
