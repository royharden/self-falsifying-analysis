# Method

Policy `s19-association-v1`, schema/catalogue version 1, engine `s19-engine-1.0.0`.

## Frozen protocol

`ProtocolV1` binds: claim text (untrusted, quoted), x/y and optional z with the asserted role `asserted_pre_exposure_common_cause`, direction, δ and units, the iid acknowledgement, seed, permutation budget B (default 199, max 499), dataset identity (normalized-table hash plus original-CSV hash or generator identity), the five recipes with fixed ordinals, the secondary display order, the 10 s per-recipe deadline, the conditioning constant 1e-8, the influence policy (4/n, ⌊0.05 n⌋, 12 rows), engine version and kernel-source digest, and an optional parent analysis id. Its canonical-JSON SHA-256 is recorded before any recipe runs. Changing anything afterwards creates a new linked analysis; the parent is never rewritten. "Protocol frozen" is not an independent preregistration.

## Estimation

- **Baseline:** centered OLS of y on x; SE = √(SSE/(n−2) / Σdx²); 95% interval β ± t(0.975, n−2)·SE.
- **Primary:** center x, y, z; residualize x and y on z; β = Σx_res·y_res / Σx_res²; SSE from the full-model residuals; df = n − 3; SE = √(SSE/df / Σx_res²). Rejected as ill-conditioned when Σx_res²/Σdx² < 1e-8.
- A constant predictor or covariate is invalid; a constant outcome is the exact zero-slope limit. Exact fits (relative SSE ≤ 1e-20) get SE 0 and a point interval.
- Compensated (Neumaier) sums; Lanczos log-gamma; Lentz continued fraction for the incomplete beta; the t quantile by bisection.

## Decision rule

The interval [lo, hi] is mapped to the claimed direction ([lo, hi] for positive, [−hi, −lo] for negative) and compared with δ: U < δ → below; L > δ → above; touching or containing δ → inconclusive. Headline precedence:

1. Malformed or mismatched evidence → integrity error (no verdict).
2. Failed baseline → inconclusive.
3. Baseline below δ → not reproduced at the declared threshold.
4. Baseline straddling δ → inconclusive.
5. Baseline above δ and no declared covariate → limited/inconclusive robustness ("Unadjusted association assessed; confounding not assessed").
6. Baseline above δ and a failed, cancelled, interrupted or inapplicable primary → inconclusive.
7. Baseline above δ and primary below δ → challenged at δ by the primary adjustment; primary above δ → not challenged by this protocol; otherwise inconclusive.

P-values are shown only as labelled descriptive diagnostics. There is no Fisher, BH, Holm or e-value headline.

## Secondary diagnostics

- **Influence:** h = 1/n + dx²/Σdx², D = (e²/(2·MSE))·h/(1−h)²; candidates D > 4/n; inapplicable for > ⌊0.05 n⌋ candidates, leverage within 1e-12 of 1, zero MSE or < 12 retained rows; otherwise a descriptive reduced fit flags when it falls below δ or reverses.
- **Rank:** average ranks for ties, OLS on ranks; flags only a reversal; δ never applied.
- **Permutation:** B seeded cumulative Fisher–Yates shuffles of the centered predictor; tail proportion (1 + #{|β_perm| ≥ |β_obs|})/(B + 1); diagnostic only.

## Reproducibility and grounding

Canonical JSON (sorted keys, −0 → 0, finite numbers only) and SHA-256 bind the table, protocol, each recipe and each terminal record. The kernel digest hashes the build's own source of the kernel files (line endings normalized). Every number in prose and charts comes from a `ReportFact` produced only after the grounding gate validates shapes, hashes, coverage, n/df, interval order, the δ comparison and cross-record consistency. Stored derived values are recomputed and compared on load. Replays compare scientific numbers with |a − b| ≤ 1e-12 + 1e-9·max(|a|, |b|) and everything else exactly; a different engine version or kernel digest is view-only.

## Benchmark

`eval/manifest.json`: development seeds 0–199 and held-out 10000–10099 (30 per cell), n ∈ {80, 200, 800}, both signs, nine families (real 2δ / δ / δ/2 with observed covariate, confounded with observed covariate, null, 2% outlier contamination, hidden confounder, heavy-tail and near-collinear stress rows). Arms: naive (two-sided p < 0.05 with the claimed sign — a different rule), guided (oracle-declared covariate, product policy), planner (scoring interface only; no paid run). Every attempted case stays in every denominator; rates carry Wilson 95% intervals. No results exist until an authorized run writes `eval/results/`.
