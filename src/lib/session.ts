import type { AnalysisRecord } from './record';

let records: AnalysisRecord[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function listSession(): AnalysisRecord[] {
  return records;
}

export function getSession(id: string): AnalysisRecord | undefined {
  return records.find((record) => record.id === id);
}

export function putSession(record: AnalysisRecord): void {
  records = [record, ...records.filter((item) => item.id !== record.id)];
  emit();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
