# Limitations

**Required statement:** Conditional association under the declared model and covariate. Unobserved confounding, asserted causal roles, measurement validity and prior claim selection are not tested. No causal proof or combined error-control guarantee.

## Scientific scope

- One numeric predictor, one numeric outcome, at most one observed covariate. No multiple controls, interactions, weights, transformations, categorical data or row filters.
- Classical homoskedastic normal-error OLS with iid rows. Grouped, clustered, repeated-measure and time-series data are out of scope; the iid acknowledgement is the user's, the app does not check it.
- The covariate's role (pre-exposure common cause) is asserted by the user. Names, labels, column order and model proposals do not establish it. Adjusting for a mediator or collider can manufacture or hide an effect; the engine cannot detect this.
- "Challenged" and "not challenged" are statements about the declared threshold δ, not about whether any nonzero effect exists. A smaller real effect can be "not reproduced" or "challenged".
- With no declared covariate the result is limited: confounding is not assessed.
- Influence, rank and permutation results are descriptive diagnostics. The reduced-sample influence interval is outcome-selected and has no confirmatory coverage. The permutation proportion does not address confounding or claim selection.
- No multiplicity or sequential error control across the five checks or across repeated analyses. Revisions made after seeing results are exploration.

## Evidence and trust

- The grounding gate checks internal consistency, not mathematical correctness or honest client authorship. A server receipt orders persistence; it does not prove prior blindness.
- A shared link exposes every row to anyone holding it; revocation stops future fetches but cannot recall copies. Share links cannot be rotated in this version.
- Records from another engine version or kernel digest are view-only; there is no migration or local bundle import.

## Planner

- The optional planner sees column metadata only, but labels can themselves disclose information. Its proposal is untrusted text; it never sets δ, seed, budgets, policy or verdict.
- With name-only anonymized columns no correct control is identifiable; the benchmark never credits such a selection.
- The per-user daily cap (24 calls, UTC day) is a cost guardrail, not protection against many accounts. A call whose dispatch outcome is uncertain stays charged and is not retried.

## Benchmark

- Synthetic families were written with knowledge of the engine and do not establish real-world generalization.
- The guided arm is oracle-assisted. Heavy-tail and near-collinear rows are out-of-assumption stress rows.
- No numbers have been measured yet.

## Runtime

Nothing in this repository has been executed (see DEVELOPMENT-STATUS.md): numerical accuracy against an independent reference, browser performance at the size limits, worker cancellation, database security and the planner's provider compatibility are all unverified.
