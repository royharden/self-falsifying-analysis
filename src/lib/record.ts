import type { AnalysisRun, ClaimSpec, Direction, Table } from './falsify/types';
import { isDirection } from './falsify/types';

export type Origin = 'upload' | 'demo' | 'generated';

export type AnalysisRecord = {
  id: string;
  createdAt: string;
  datasetName: string;
  origin: Origin;
  table: Table;
  claim: ClaimSpec;
  run: AnalysisRun;
  saved: boolean;
  shareToken: string | null;
  isShared: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asDirection(value: unknown): Direction | null {
  return typeof value === 'string' && isDirection(value) ? value : null;
}

export function asTable(columns: unknown, rows: unknown): Table | null {
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null;
  if (!columns.every((column) => typeof column === 'string')) return null;
  const tableRows: number[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || !row.every((cell) => typeof cell === 'number' && Number.isFinite(cell))) return null;
    tableRows.push(row);
  }
  return { columns, rows: tableRows };
}
