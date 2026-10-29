import type { AnalysisRecord } from './record';

/**
 * In-memory store for this tab. Nothing is persisted locally or uploaded
 * automatically; a reload loses unsaved work (the setup banner says so).
 */
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

export function removeSession(id: string): void {
  records = records.filter((item) => item.id !== id);
  emit();
}

/** Drops records loaded from or saved to an account; local tab-only work stays. */
export function clearSavedRecords(): void {
  records = records.filter((item) => item.persistence.kind === 'local');
  emit();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let pendingRevision: AnalysisRecord | null = null;

/** Hands a parent record to the next New analysis page (revision linked by parentAnalysisId). */
export function setRevision(record: AnalysisRecord): void {
  pendingRevision = record;
}

/** Non-destructive read: StrictMode may call state initializers twice. */
export function takeRevision(): AnalysisRecord | null {
  return pendingRevision;
}

export function clearRevision(): void {
  pendingRevision = null;
}
