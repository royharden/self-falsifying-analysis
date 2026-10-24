/**
 * Build-bound manifest of the numerical kernel source (PLAN.md 4.1). Vite inlines
 * the exact file text at build time; the digest binds that text. The text is shown
 * read-only and is never evaluated or loaded as code.
 */
import { canonicalHash, sha256Text } from './falsify/canonical';

/** Kernel files whose behaviour the digest binds. scripts/eval.ts hashes the same list. */
export const KERNEL_FILES = [
  'aggregate.ts',
  'attacks.ts',
  'canonical.ts',
  'ols.ts',
  'planSchema.ts',
  'prng.ts',
  'runner.ts',
  'stats.ts',
  'table.ts',
  'types.ts',
] as const;

const raw = import.meta.glob('./falsify/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export type KernelFile = { path: string; sha256: string; text: string };

export const kernelFiles: KernelFile[] = KERNEL_FILES.map((name) => {
  const text = raw[`./falsify/${name}`];
  if (typeof text !== 'string') throw new Error(`Kernel source ${name} is missing from the build.`);
  return { path: `src/lib/falsify/${name}`, sha256: sha256Text(text), text };
});

/** Digest of the sorted manifest [{path, sha256}]. */
export const engineSourceDigest: string = canonicalHash(kernelFiles.map(({ path, sha256 }) => ({ path, sha256 })));
