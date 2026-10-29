/**
 * Seeded synthetic generators (PLAN.md 9.1). Generator truth stays here; the
 * analyser only sees the table and the user-declared claim. Values below are
 * deterministic settings, not measured fit outputs.
 */
import { mixSeed, mulberry32, normal } from './prng';
import { normalizedTableHash } from './table';
import type { DatasetIdentity, Direction, FixtureSource, Table } from './types';

/** Normal sampler: Box-Muller cosine branch over mulberry32 (prng.ts). One normal per two uniforms. */
export const GENERATOR_VERSION = 's19-gen-1 (mulberry32 + Box-Muller cosine)';

export type ColumnRole = 'predictor' | 'outcome' | 'pre_exposure_common_cause' | 'independent_decoy' | 'post_exposure';

export type ColumnMeta = { id: string; label: string; role: ColumnRole; units: string };

export type Fixture = {
  fixtureId: string;
  title: string;
  description: string;
  table: Table;
  columns: ColumnMeta[];
  source: FixtureSource;
  dataset: DatasetIdentity;
  /** Suggested settings shown to the user before freeze; the user may edit them. */
  suggestion: {
    statement: string;
    x: string;
    y: string;
    z: string;
    direction: Direction;
    delta: number;
    xUnits: string;
    yUnits: string;
  };
  /** Structural slope used by the generator. Not visible to the engine. */
  structuralSlope: number;
};

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}

function identity(table: Table, source: FixtureSource): DatasetIdentity {
  return { normalizedHash: normalizedTableHash(table), rowCount: table.rows.length, columnCount: table.columns.length, source };
}

/**
 * Workshop fixtures: x = 5 + 2z + u hours, prior_score = 50 + 10z,
 * final_score = 70 + beta*x + 4z + e, n = 200, delta = 0.5 points/hour.
 * beta = 0 is the confounded demo, beta = 1 the real-effect companion.
 */
export function workshopFixture(kind: 'confounded' | 'real'): Fixture {
  const beta = kind === 'real' ? 1 : 0;
  const seed = kind === 'real' ? 19020 : 19019;
  const n = 200;
  const rng = mulberry32(seed);
  const rows: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const z = normal(rng);
    const u = normal(rng);
    const e = normal(rng);
    const decoy = normal(rng);
    const post = normal(rng);
    const hours = 5 + 2 * z + u;
    const prior = 50 + 10 * z;
    const final = 70 + beta * hours + 4 * z + e;
    const homework = 2 + 0.8 * hours + 0.5 * post;
    rows.push([round3(hours), round3(final), round3(prior), round3(decoy), round3(homework)]);
  }
  const table: Table = { columns: ['hours', 'final_score', 'prior_score', 'attendance_noise', 'homework_done'], rows };
  const fixtureId = kind === 'real' ? 'workshop_real' : 'workshop_confounded';
  const source: FixtureSource = {
    kind: 'fixture',
    fixtureId,
    generatorVersion: GENERATOR_VERSION,
    seed,
    parameters: { beta, n, delta: 0.5, priorLoadingOnHours: 2, priorLoadingOnScore: 4 },
  };
  return {
    fixtureId,
    title: kind === 'real' ? 'Workshop hours — real effect companion' : 'Workshop hours — confounded',
    description:
      kind === 'real'
        ? 'Synthetic iid table. Prior score drives hours and the final score, and hours also raise the score by 1 point per hour.'
        : 'Synthetic iid table. Prior score drives both hours and the final score; hours have no structural effect.',
    table,
    columns: [
      { id: 'hours', label: 'Workshop hours', role: 'predictor', units: 'hours' },
      { id: 'final_score', label: 'Final score', role: 'outcome', units: 'points' },
      { id: 'prior_score', label: 'Prior score (measured before the workshop)', role: 'pre_exposure_common_cause', units: 'points' },
      { id: 'attendance_noise', label: 'Attendance noise (unrelated)', role: 'independent_decoy', units: 'index' },
      { id: 'homework_done', label: 'Homework done (after the workshop)', role: 'post_exposure', units: 'tasks' },
    ],
    source,
    dataset: identity(table, source),
    suggestion: {
      statement: 'More workshop hours raise the final score.',
      x: 'hours',
      y: 'final_score',
      z: 'prior_score',
      direction: 'positive',
      delta: 0.5,
      xUnits: 'hours',
      yUnits: 'points',
    },
    structuralSlope: beta,
  };
}

/* ------------------------------------------------------------------ */
/* Benchmark families. */

export const FAMILIES = [
  'real_adjusted',
  'real_weak',
  'real_boundary',
  'confounded_observed',
  'null',
  'outlier_contamination',
  'unobserved_confounding',
  'stress_heavy_tail',
  'stress_near_collinear',
] as const;

export type Family = (typeof FAMILIES)[number];

/** Fixed benchmark threshold on the unit-variance scale. */
export const BENCH_DELTA = 0.2;

export type CaseSpec = {
  family: Family;
  seed: number;
  n: number;
  /** beta / delta ratio for the structural slope. */
  ratio: number;
  sign: 1 | -1;
};

export type GeneratedCase = {
  spec: CaseSpec;
  table: Table;
  dataset: DatasetIdentity;
  /** Role metadata given to the evaluation condition (and a planner arm), never inferred by the engine. */
  columns: ColumnMeta[];
  /** Covariate the guided arm declares, or null when no valid primary exists. */
  guidedCovariate: string | null;
  direction: Direction;
  delta: number;
  structuralSlope: number;
  contaminatedIndices: number[];
};

const FAMILY_SALT: Record<Family, number> = {
  real_adjusted: 11,
  real_weak: 12,
  real_boundary: 13,
  confounded_observed: 14,
  null: 15,
  outlier_contamination: 16,
  unobserved_confounding: 17,
  stress_heavy_tail: 18,
  stress_near_collinear: 19,
};

/** Student t with 3 df scaled to unit variance: N / sqrt(chi2_3 / 3) / sqrt(3). */
function t3Unit(rng: () => number): number {
  const a = normal(rng);
  const b = normal(rng);
  const c = normal(rng);
  const chi = a * a + b * b + c * c;
  return normal(rng) / Math.sqrt(chi / 3) / Math.sqrt(3);
}

/**
 * Base iid generator: z, u, e ~ N(0,1), x = 0.6z + 0.8u, y = s*(beta*x + 0.8z) + e.
 * null: x = u, y = e with an irrelevant z. Decoy is independent; post = 0.7x + 0.5*noise.
 */
export function generateCase(spec: CaseSpec): GeneratedCase {
  const { family, n, sign } = spec;
  const beta = spec.ratio * BENCH_DELTA;
  const rng = mulberry32(mixSeed(spec.seed >>> 0, FAMILY_SALT[family]));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const decoys: number[] = [];
  const posts: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const z = normal(rng);
    const u = normal(rng);
    const noise = family === 'stress_heavy_tail' ? t3Unit(rng) : normal(rng);
    const decoy = normal(rng);
    const postNoise = normal(rng);
    let x: number;
    let y: number;
    if (family === 'null') {
      x = u;
      y = noise;
    } else if (family === 'stress_near_collinear') {
      x = 0.995 * z + 0.0999 * u;
      y = sign * (beta * x + 0.8 * z) + noise;
    } else {
      x = 0.6 * z + 0.8 * u;
      y = sign * (beta * x + 0.8 * z) + noise;
    }
    xs.push(x);
    ys.push(y);
    zs.push(z);
    decoys.push(decoy);
    posts.push(0.7 * x + 0.5 * postNoise);
  }
  const contaminatedIndices: number[] = [];
  if (family === 'outlier_contamination') {
    // Fixed declared operation: floor(2% of n) indices chosen by a seeded shuffle; x += 3, y -= 6s.
    const count = Math.floor(0.02 * n);
    const order = xs.map((_, index) => index);
    const pick = mulberry32(mixSeed(spec.seed >>> 0, 99));
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(pick() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const index of order.slice(0, count).sort((a, b) => a - b)) {
      xs[index] += 3;
      ys[index] -= 6 * sign;
      contaminatedIndices.push(index);
    }
  }
  const hideZ = family === 'unobserved_confounding';
  const columns = hideZ ? ['x', 'y', 'decoy', 'post'] : ['x', 'y', 'z', 'decoy', 'post'];
  const rows = xs.map((x, index) =>
    hideZ ? [x, ys[index], decoys[index], posts[index]] : [x, ys[index], zs[index], decoys[index], posts[index]],
  );
  const table: Table = { columns, rows };
  const source: FixtureSource = {
    kind: 'fixture',
    fixtureId: `bench_${family}`,
    generatorVersion: GENERATOR_VERSION,
    seed: spec.seed >>> 0,
    parameters: { n, ratio: spec.ratio, sign, beta, delta: BENCH_DELTA },
  };
  const meta: ColumnMeta[] = [
    { id: 'x', label: 'x', role: 'predictor', units: 'unit' },
    { id: 'y', label: 'y', role: 'outcome', units: 'unit' },
    ...(hideZ ? [] : [{ id: 'z', label: 'z', role: 'pre_exposure_common_cause' as const, units: 'unit' }]),
    { id: 'decoy', label: 'decoy', role: 'independent_decoy', units: 'unit' },
    { id: 'post', label: 'post', role: 'post_exposure', units: 'unit' },
  ];
  return {
    spec,
    table,
    dataset: identity(table, source),
    columns: meta,
    guidedCovariate: hideZ ? null : 'z',
    direction: sign === 1 ? 'positive' : 'negative',
    delta: BENCH_DELTA,
    structuralSlope: family === 'null' ? 0 : sign * beta,
    contaminatedIndices,
  };
}
