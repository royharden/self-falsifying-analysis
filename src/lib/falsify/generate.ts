import { mixSeed, mulberry32, normal } from './prng';
import type { ClaimSpec, Table } from './types';

export type CaseKind = 'noise' | 'planted_real' | 'planted_spurious';

export type GeneratedCase = {
  kind: CaseKind;
  seed: number;
  table: Table;
  claim: ClaimSpec;
  structuralSlope: number;
};

const KIND_SALT: Record<CaseKind, number> = {
  noise: 1,
  planted_real: 2,
  planted_spurious: 3,
};

/**
 * Seeded tables. noise: x and y independent. planted_real: y depends on x.
 * planted_spurious: a latent z drives both x and y, and the partial slope of
 * y on x given z is zero in the generating process.
 */
export function generateCase(kind: CaseKind, seed: number, rows: number): GeneratedCase {
  const rng = mulberry32(mixSeed(seed >>> 0, KIND_SALT[kind]));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const decoys: number[] = [];
  for (let i = 0; i < rows; i += 1) {
    const latent = normal(rng);
    const shockX = normal(rng);
    const shockY = normal(rng);
    decoys.push(normal(rng));
    if (kind === 'noise') {
      xs.push(latent);
      zs.push(shockX);
      ys.push(shockY);
    } else if (kind === 'planted_real') {
      xs.push(latent);
      zs.push(shockX);
      ys.push(0.8 * latent + 0.05 * shockX + shockY);
    } else {
      zs.push(latent);
      xs.push(0.95 * latent + 0.1 * shockX);
      ys.push(0.95 * latent + 0.1 * shockY);
    }
  }
  const table: Table = {
    columns: ['x', 'y', 'z', 'decoy'],
    rows: xs.map((value, index) => [value, ys[index], zs[index], decoys[index]]),
  };
  return {
    kind,
    seed: seed >>> 0,
    table,
    claim: {
      statement: 'x raises y.',
      outcome: 'y',
      predictor: 'x',
      direction: 'positive',
      confounder: null,
    },
    structuralSlope: kind === 'planted_real' ? 0.8 : 0,
  };
}

export function workshopDemo(): GeneratedCase {
  const generated = generateCase('planted_spurious', 19019, 180);
  const rename: Record<string, string> = {
    x: 'hours',
    y: 'final_score',
    z: 'prior_score',
    decoy: 'attendance_noise',
  };
  return {
    ...generated,
    table: {
      columns: generated.table.columns.map((column) => rename[column] ?? column),
      rows: generated.table.rows,
    },
    claim: {
      statement: 'More workshop hours raise the final score.',
      outcome: 'final_score',
      predictor: 'hours',
      direction: 'positive',
      confounder: 'prior_score',
    },
  };
}
