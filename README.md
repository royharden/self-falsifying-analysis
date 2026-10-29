# Self-falsifying analysis

A browser app that tries to break a stated association in a small numeric table — under rules you freeze before seeing any result — and lets any reader rerun every check.

You declare one directional claim (x → y, positive or negative), a practical threshold **δ** (the smallest slope that would matter, in outcome units per predictor unit) and at most **one** covariate you assert is a pre-exposure common cause, or explicitly none. The protocol is hashed and frozen. A deterministic engine in a Web Worker then runs five fixed recipes:

1. **Baseline** — unadjusted OLS slope with a classical 95% t interval.
2. **Primary** — the same slope adjusted for your covariate (one-control Frisch–Waugh–Lovell, df = n − 3).
3. **Influence** — Cook's-distance sensitivity (descriptive).
4. **Rank** — rank-on-rank slope (different estimand; only a reversal is flagged).
5. **Permutation** — predictor-shuffle diagnostic (never flags, never decides).

The headline compares the claimed-direction intervals with δ: *challenged at δ by the primary adjustment*, *not challenged by this protocol*, *not reproduced at the declared threshold*, *limited / inconclusive* (no covariate declared: "Unadjusted association assessed; confounding not assessed"), *inconclusive*, or *integrity error*. Secondary diagnostics never change it. Every planned check — including failed, inapplicable and cancelled ones — stays visible with its recipe, its reasons and the exact kernel source bound by digest. Any reader can rerun one recipe or all five and get a field-level comparison.

This is a conditional-association check under declared assumptions. It is **not** causal proof: unobserved confounding, the covariate's causal role, measurement validity and prior claim selection are not tested. See [docs/METHOD.md](docs/METHOD.md) and [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Modes

- **Local guided mode** (no environment variables): workshop demos (confounded and real-effect), strict CSV upload (≤ 1 MiB, 40–5000 rows, 2–24 numeric columns — [docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md)), runs, reruns, `run.json` / `events.jsonl` export and a ≤ 20-case seeded benchmark. Nothing is uploaded; a reload loses unsaved work.
- **Live mode** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`): email/password accounts, owner-private saves (server receipt before running, or "uploaded after execution"), immutable unlisted share links with revocation, privacy deletion, and an optional paid planner that sees column metadata only and requires a confirmed email.

## Status — read this first

**Built, not run.** This source was written under a "Dirty Mode" construction run (2026-10-23): static checks only. Specifically:

- Nothing has been installed (no `node_modules`, **no lockfile**), built, served, or opened in a browser.
- The unit/contract tests under `tests/` are **authored but have never been executed**. Unrun tests are not passes.
- The SQL migration has **not been applied** to any database; RLS, grants, triggers and RPCs are unexercised.
- The `plan-attacks` edge function has not been type-checked by Deno, deployed or called; **no paid provider call** has been made.
- The benchmark has produced **no results**; any results table must come from `eval/results/` after an authorized run. Not yet measured.

What *was* checked: a no-emit TypeScript pass over `src/`, `tests/`, `scripts/` and the edge function using scratch type stubs, plus static code review of each package by separate reviewer agents. Details and the full deferred list: [DEVELOPMENT-STATUS.md](DEVELOPMENT-STATUS.md), [DEFERRED-VALIDATION.md](DEFERRED-VALIDATION.md). Provisioning notes for Bolt: [BOLT-HANDOFF.md](BOLT-HANDOFF.md).

## Commands (once installation is authorized)

```sh
npm install          # first install creates package-lock.json; later use npm ci
npm run typecheck    # app/tests (tsconfig.json) and scripts (tsconfig.scripts.json); Deno function is separate
npm test             # vitest
npm run build        # vite build -> dist/
npm run dev          # local dev server
npm run eval -- --split development [--limit N]   # writes eval/results/results.{json,md}
```

Held-out evaluation (`--split heldout`) is only meaningful after policy constants are frozen; do not tune on it.

## Layout

- `src/lib/falsify/` — numerical kernel (CSV contract, canonical JSON/SHA-256, OLS/FWL, recipes, policy, protocol, grounding, generators, evaluator)
- `src/lib/worker/` — engine and benchmark workers and their controllers
- `src/lib/api/` — RPC persistence client and planner client
- `src/pages/`, `src/components/` — React UI (hash routing)
- `supabase/migrations/` — single baseline schema; `supabase/functions/plan-attacks/` — planner edge function
- `eval/manifest.json`, `scripts/eval.ts` — frozen benchmark manifest and entrypoint

MIT licence (see `LICENSE`).
