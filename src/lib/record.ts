import type { BundleV1, ExecutionRecord } from './falsify/bundle';
import type { ColumnMeta } from './falsify/generate';
import type { HeaderMapEntry, ProtocolV1, Table } from './falsify/types';

/** Where the record lives. Local records are lost on reload unless exported or saved. */
export type Persistence =
  | { kind: 'local' }
  | {
      kind: 'saved';
      origin: 'server_frozen' | 'uploaded_after_execution';
      serverReceivedAt: string | null;
    }
  | { kind: 'shared_view' };

export type ShareState = { enabled: boolean; token: string | null };

/** Derived values stored alongside evidence; only ever compared with regenerated ones. */
export type StoredDerived = { headlineCode: string; factsHash: string };

export type AnalysisRecord = {
  id: string;
  createdAt: string;
  datasetName: string;
  table: Table;
  headerMap: HeaderMapEntry[] | null;
  columns: ColumnMeta[] | null;
  protocol: ProtocolV1;
  protocolHash: string;
  /** First full execution; the evidence a headline is read from. */
  originalExecutionId: string | null;
  executions: ExecutionRecord[];
  persistence: Persistence;
  share: ShareState | null;
  /** Server lifecycle id of the original execution when saved via freeze_protocol. */
  serverExecutionId: string | null;
  storedDerived: StoredDerived | null;
  /** Executions already persisted on the server. */
  savedExecutionIds: string[];
};

export function originalExecution(record: AnalysisRecord): ExecutionRecord | null {
  if (!record.originalExecutionId) return null;
  return record.executions.find((execution) => execution.executionId === record.originalExecutionId) ?? null;
}

export function toBundle(record: AnalysisRecord, derived: BundleV1['derived']): BundleV1 {
  return {
    bundleSchema: 1,
    analysisId: record.id,
    parentAnalysisId: record.protocol.parentAnalysisId,
    datasetName: record.datasetName,
    createdAt: record.createdAt,
    table: record.table,
    protocol: record.protocol,
    protocolHash: record.protocolHash,
    originalExecutionId: record.originalExecutionId,
    executions: record.executions,
    derived,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
