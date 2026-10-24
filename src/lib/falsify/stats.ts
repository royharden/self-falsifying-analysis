/**
 * Numerical Recipes gammln. Used only for the beta function behind the t p-value.
 * Attacks on one sample are dependent, so nothing here is a Type-I guarantee.
 */
export function logGamma(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < cof.length; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxSteps = 200;
  const epsilon = 3e-14;
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
  const lnBeta = logBeta(a, b);
  const threshold = (a + 1) / (a + b + 2);
  const logFront = Math.log(x) * a + Math.log(1 - x) * b - lnBeta;
  if (x < threshold) {
    return (Math.exp(logFront) / a) * betaContinuedFraction(x, a, b);
  }
  return 1 - (Math.exp(logFront) / b) * betaContinuedFraction(1 - x, b, a);
}

/** Two-sided Student t tail. df = 1 is Cauchy: t = sqrt(3) has p = 1/3. */
export function studentTTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return Number.NaN;
  const absT = Math.abs(t);
  if (absT === 0) return 1;
  if (!Number.isFinite(absT)) return 0;
  const x = df / (df + absT * absT);
  const p = regularizedIncompleteBeta(x, df / 2, 0.5);
  if (!Number.isFinite(p)) return Number.NaN;
  return Math.min(1, Math.max(0, p));
}

/**
 * Fisher's combination. df = 2k is even, so the chi-square survival is a
 * finite Poisson sum. A single input p is returned unchanged.
 */
export function fisherCombinedP(pValues: readonly number[]): number | null {
  const usable = pValues.filter((p) => Number.isFinite(p) && p > 0 && p <= 1);
  if (usable.length === 0) return null;
  let chiSquare = 0;
  for (const p of usable) {
    chiSquare += -2 * Math.log(Math.min(1, Math.max(p, 1e-300)));
  }
  const k = usable.length;
  const x = chiSquare / 2;
  let term = 1;
  let sum = 1;
  for (let m = 1; m < k; m += 1) {
    term *= x / m;
    sum += term;
    if (!Number.isFinite(sum)) return 0;
  }
  const survivor = Math.exp(-x) * sum;
  if (!Number.isFinite(survivor)) return 0;
  return Math.min(1, Math.max(0, survivor));
}

/** Benjamini-Hochberg adjusted p-values, same order as the input. */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(m);
  let running = 1;
  for (let rank = m - 1; rank >= 0; rank -= 1) {
    const raw = (order[rank].p * m) / (rank + 1);
    running = Math.min(running, raw);
    adjusted[order[rank].index] = Math.min(1, Math.max(0, running));
  }
  return adjusted;
}

/**
 * Vovk-style calibrator e(p) = 0.5 * p^(-0.5). Integral over (0, 1] is 1.
 * The product across attacks on one table is descriptive only.
 */
export function eCalibrator(p: number): number {
  const clamped = Math.min(1, Math.max(p, 1e-300));
  return 0.5 / Math.sqrt(clamped);
}

export function eProduct(pValues: readonly number[]): { product: number; capped: boolean } | null {
  if (pValues.length === 0) return null;
  let product = 1;
  let capped = false;
  for (const p of pValues) {
    product *= eCalibrator(p);
    if (product > 1e12) {
      product = 1e12;
      capped = true;
      break;
    }
  }
  return { product, capped };
}

export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n !== y.length || n < 3) return null;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i += 1) {
    meanX += x[i];
    meanY += y[i];
  }
  meanX /= n;
  meanY /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx <= 1e-18 || syy <= 1e-18) return null;
  return sxy / Math.sqrt(sxx * syy);
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
