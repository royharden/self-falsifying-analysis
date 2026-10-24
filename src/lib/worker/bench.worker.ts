/** Benchmark worker: evaluates one seeded case per request, off the main thread. */
import { DEFAULT_MANIFEST, evaluateCase, type CaseResult } from '../falsify/evaluate';
import type { CaseSpec } from '../falsify/generate';

type BenchRequest = { requestId: string; spec: CaseSpec; engineSourceDigest: string };
type BenchResponse = { requestId: string; result: CaseResult };

type WorkerScope = {
  postMessage(message: BenchResponse): void;
  onmessage: ((event: MessageEvent<BenchRequest>) => void) | null;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<BenchRequest>) => {
  const { requestId, spec, engineSourceDigest } = event.data;
  scope.postMessage({ requestId, result: evaluateCase(spec, DEFAULT_MANIFEST, engineSourceDigest) });
};
