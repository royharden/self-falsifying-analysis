/**
 * Benchmark entrypoint (PLAN.md 9). Runs the same pure engine and policy as the app.
 * Usage (only when an evaluation run is authorized):
 *   npm run eval -- --split development [--limit 40]
 *   npm run eval -- --split heldout          (only after policy/constants are frozen)
 * Writes eval/results/results.json and eval/results/results.md. No network, no paid arm.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineSourceDigest } from '../src/lib/engineSource';
import {
  DEFAULT_MANIFEST,
  evaluateCase,
  expandManifest,
  manifestHash,
  renderMarkdown,
  summarize,
  validateManifest,
  type CaseResult,
  type Manifest,
  type SplitName,
} from '../src/lib/falsify/evaluate';

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'eval/manifest.json'), 'utf8')) as Manifest;
const problems = validateManifest(manifest);
if (manifestHash(manifest) !== manifestHash(DEFAULT_MANIFEST)) problems.push('eval/manifest.json differs from DEFAULT_MANIFEST in evaluate.ts.');
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const split = (argument('split') ?? 'development') as SplitName;
if (split !== 'development' && split !== 'heldout') {
  console.error('--split must be development or heldout');
  process.exit(1);
}
const limitText = argument('limit');
const all = expandManifest(manifest, split);
const limit = limitText === null ? all.length : Number(limitText);
if (!Number.isInteger(limit) || limit < 1) {
  console.error('--limit must be a positive integer');
  process.exit(1);
}
const specs = all.slice(0, limit);
if (specs.length < all.length) console.log(`Partial run: ${specs.length} of ${all.length} manifest cases (not a full campaign).`);

let revision = 'unknown (git unavailable)';
try {
  revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (dirty) revision += ' (working tree has uncommitted changes)';
} catch {
  // Keep the explicit unknown label.
}

const results: CaseResult[] = [];
specs.forEach((spec, index) => {
  results.push(evaluateCase(spec, manifest, engineSourceDigest));
  if ((index + 1) % 100 === 0) console.log(`${index + 1}/${specs.length} cases`);
});

// expectedCases is the full manifest count, so a --limit run reports itself as partial.
const report = summarize(results, manifest, split, engineSourceDigest, all.length);
const invocation = `npm run eval -- ${process.argv.slice(2).join(' ')}`.trim();
const outDir = resolve(root, 'eval/results');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'results.json'), `${JSON.stringify({ invocation, revision, report, cases: results }, null, 2)}\n`);
writeFileSync(resolve(outDir, 'results.md'), renderMarkdown(report, invocation, revision));
console.log(`Wrote ${results.length} cases to eval/results/.`);
