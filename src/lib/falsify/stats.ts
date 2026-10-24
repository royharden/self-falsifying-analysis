/**
 * Student t distribution and small numerical helpers.
 * Known-answer checks against an independent reference are deferred (PLAN.md section 11).
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Gamma(x) for x >= 0.5, Lanczos g = 7, n = 9. */
export function logGamma(x: number): number {
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < LANCZOS.length; i += 1) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Modified Lentz continued fraction for the incomplete beta function. */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxSteps = 500;
  const epsilon = 1e-15;
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxSteps; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logFront = Math.log(x) * a + Math.log1p(-x) * b - logBeta(a, b);
  if (x < (a + 1) / (a + b + 2)) {
    return (Math.exp(logFront) / a) * betaContinuedFraction(x, a, b);
  }
  return 1 - (Math.exp(logFront) / b) * betaContinuedFraction(1 - x, b, a);
}

/** Upper tail P(T > t) for t >= 0. */
function upperTail(t: number, df: number): number {
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  return 0.5 * regularizedIncompleteBeta(x, df / 2, 0.5);
}

/** Student t CDF. df = 1 is Cauchy: F(1) = 0.75. */
export function studentTCdf(t: number, df: number): number {
  if (Number.isNaN(t) || !Number.isFinite(df) || df <= 0) return Number.NaN;
  if (t === Number.POSITIVE_INFINITY) return 1;
  if (t === Number.NEGATIVE_INFINITY) return 0;
  const tail = upperTail(Math.abs(t), df);
  return t >= 0 ? 1 - tail : tail;
}

/** Two-sided p-value against zero. Descriptive diagnostic only. */
export function studentTTwoSidedP(t: number, df: number): number {
  if (Number.isNaN(t) || !Number.isFinite(df) || df <= 0) return Number.NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, 2 * upperTail(Math.abs(t), df)));
}

/**
 * Quantile for p in (0.5, 1): bisection on the upper tail, then the last bracket midpoint.
 * Deterministic to the last few ulps; used for t_(0.975, df).
 */
export function studentTQuantile(p: number, df: number): number {
  if (!(p > 0.5 && p < 1) || !Number.isFinite(df) || df <= 0) return Number.NaN;
  const target = 1 - p;
  let lo = 0;
  let hi = 1;
  while (upperTail(hi, df) > target) {
    hi *= 2;
    if (hi > 1e12) return Number.NaN;
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (mid === lo || mid === hi) break;
    if (upperTail(mid, df) > target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Neumaier compensated sum. */
export function compensatedSum(values: ArrayLike<number>): number {
  let sum = 0;
  let correction = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const next = sum + value;
    if (Math.abs(sum) >= Math.abs(value)) correction += sum - next + value;
    else correction += value - next + sum;
    sum = next;
  }
  return sum + correction;
}

export function mean(values: ArrayLike<number>): number {
  return compensatedSum(values) / values.length;
}

/** Average ranks, 1-based. Ties share the mean of the ranks they cover. */
export function averageRanks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = new Array<number>(values.length);
  let start = 0;
  while (start < indexed.length) {
    let end = start;
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[start].value) end += 1;
    const average = (start + 1 + (end + 1)) / 2;
    for (let k = start; k <= end; k += 1) ranks[indexed[k].index] = average;
    start = end + 1;
  }
  return ranks;
}
