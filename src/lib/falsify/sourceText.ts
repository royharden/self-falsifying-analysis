import type { RecipeKind } from './types';

/**
 * Human-readable procedure for each fixed recipe. This is the recipe description;
 * the executable kernel source shown to readers is bound separately by digest
 * (engineSource.ts). Nothing here is evaluated.
 */
export const RECIPE_TITLES: Record<RecipeKind, string> = {
  baseline_ols: 'Baseline: unadjusted OLS slope',
  adjusted_ols: 'Primary: slope adjusted for the asserted covariate',
  influence: 'Secondary: influential-row sensitivity (Cook’s distance)',
  rank_sensitivity: 'Secondary: rank-on-rank slope',
  predictor_permutation: 'Secondary: predictor permutation diagnostic',
};

export const RECIPE_PROCEDURES: Record<RecipeKind, string> = {
  baseline_ols:
    'Center x and y. Slope = Σ dx·dy / Σ dx². Residuals from the fitted line; MSE = SSE/(n−2); SE = √(MSE/Σ dx²). 95% interval = slope ± t(0.975, n−2)·SE. Transform to the claimed direction and compare with δ: above δ = reproduced, below δ = not reproduced, touching or containing δ = inconclusive.',
  adjusted_ols:
    'Center x, y and the asserted covariate z. Residualize x and y on z (Frisch–Waugh–Lovell). Reject when Σ x_res² / Σ dx² < 1e-8. Slope = Σ x_res·y_res / Σ x_res²; MSE = SSE/(n−3); SE = √(MSE/Σ x_res²). Same 95% interval and δ comparison as the baseline: below δ = challenged, above δ = retained, otherwise inconclusive. Inapplicable when no covariate was declared.',
  influence:
    'On the unchanged baseline rows compute leverage h = 1/n + dx²/Σ dx² and Cook’s D = (e²/(2·MSE))·h/(1−h)². Candidates: D > 4/n. None → no flag. More than ⌊0.05·n⌋ candidates, leverage within 1e-12 of 1, zero MSE or fewer than 12 retained rows → inapplicable. Otherwise refit without the candidates; flag when the descriptive interval falls below δ or the slope reverses. Outcome-selected, descriptive only; the original rows are never deleted.',
  rank_sensitivity:
    'Replace x and y by average ranks (ties share the mean rank) and fit the baseline OLS on the ranks. Flag only a reversal of the claimed direction. Rank-slope units differ from raw units, so δ is never applied and the result is never pooled with raw slopes.',
  predictor_permutation:
    'With the frozen seed, apply B cumulative Fisher–Yates shuffles to the centered predictor against the unchanged outcome. Statistic: absolute unadjusted slope. Tail proportion = (1 + #{|slope_perm| ≥ |slope_obs|}) / (B + 1). Assumes exchangeable rows under no association. Diagnostic only: it never flags, never decides the headline, and does not address confounding or prior claim selection.',
};
