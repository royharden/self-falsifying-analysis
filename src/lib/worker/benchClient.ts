/**
 * Runs a small browser campaign case by case in a worker, with progress and
 * cancellation. A case that exceeds the per-case deadline is recorded as failed and
 * stays in its denominator.
 */
import type { CaseResult } from '../falsify/evaluate';
import type { CaseSpec } from '../falsify/generate';

/** Per-case bound (five recipes plus the naive arm), not the 10 s per-recipe interactive deadline. */
export const CASE_DEADLINE_MS = 30_000;

export type CampaignHandle = { cancel: () => void; done: Promise<{ results: CaseResult[]; cancelled: boolean }> };

function failed(spec: CaseSpec, reason: string): CaseResult {
  return {
    spec,
    structuralSlope: Number.NaN,
    contaminatedIndices: [],
    naive: { ok: false, reason },
    guided: { ok: false, reason },
  };
}

export function runCampaignInWorker(
  specs: CaseSpec[],
  engineSourceDigest: string,
  onProgress: (results: CaseResult[]) => void,
): CampaignHandle {
  const results: CaseResult[] = [];
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let index = 0;
  let stopped = false;
  let resolveDone: (value: { results: CaseResult[]; cancelled: boolean }) => void = () => undefined;
  const done = new Promise<{ results: CaseResult[]; cancelled: boolean }>((resolve) => {
    resolveDone = resolve;
  });

  const spawn = () => {
    worker = new Worker(new URL('./bench.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ requestId: string; result: CaseResult }>) => {
      if (stopped || event.data.requestId !== String(index)) return;
      if (timer) clearTimeout(timer);
      results.push(event.data.result);
      onProgress([...results]);
      index += 1;
      next();
    };
    worker.onerror = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      results.push(failed(specs[index], 'The benchmark worker stopped unexpectedly.'));
      onProgress([...results]);
      index += 1;
      worker?.terminate();
      spawn();
      next();
    };
  };

  const finish = (cancelled: boolean) => {
    if (stopped) return;
    if (cancelled && index < specs.length) {
      // The started case is recorded as cancelled; unstarted cases are simply not attempted.
      results.push(failed(specs[index], 'Cancelled while running.'));
      onProgress([...results]);
    }
    stopped = true;
    if (timer) clearTimeout(timer);
    worker?.terminate();
    resolveDone({ results, cancelled });
  };

  const next = () => {
    if (stopped) return;
    if (index >= specs.length) {
      finish(false);
      return;
    }
    const current = index;
    timer = setTimeout(() => {
      if (stopped || index !== current) return;
      results.push(failed(specs[current], `No result within ${CASE_DEADLINE_MS} ms.`));
      onProgress([...results]);
      index += 1;
      worker?.terminate();
      spawn();
      next();
    }, CASE_DEADLINE_MS);
    worker?.postMessage({ requestId: String(current), spec: specs[current], engineSourceDigest });
  };

  spawn();
  next();
  return { cancel: () => finish(true), done };
}
