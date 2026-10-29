import { canonicalHash } from './canonical';
import type { Table } from './types';

export const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
export const MAX_BYTES = 1_048_576;
export const MAX_ROWS = 5000;
export const MIN_ROWS = 40;
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 24;

/**
 * Deterministic header normalization (PLAN.md section 2, DATA-CONTRACT):
 * trim, collapse each run outside [A-Za-z0-9_] to "_", strip outer "_",
 * reject empty, prefix "col_" when the first character is not a letter,
 * reject results longer than 41 characters.
 */
export function normalizeHeader(raw: string): string | null {
  const collapsed = raw.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (collapsed === '') return null;
  const prefixed = /^[A-Za-z]/.test(collapsed) ? collapsed : `col_${collapsed}`;
  if (prefixed.length > 41 || !IDENTIFIER.test(prefixed)) return null;
  return prefixed;
}

export function columnValues(table: Table, name: string): number[] | null {
  const index = table.columns.indexOf(name);
  if (index < 0) return null;
  return table.rows.map((row) => row[index]);
}

/** Structural validation of a normalized table. Returns every problem found, up to a cap. */
export function validateTable(table: Table): string[] {
  const errors: string[] = [];
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) return ['The table is malformed.'];
  if (table.columns.length < MIN_COLUMNS || table.columns.length > MAX_COLUMNS) {
    errors.push(`Use between ${MIN_COLUMNS} and ${MAX_COLUMNS} columns.`);
  }
  const seen = new Set<string>();
  for (const name of table.columns) {
    if (typeof name !== 'string' || !IDENTIFIER.test(name)) errors.push(`Column "${String(name)}" is not a valid identifier.`);
    else if (seen.has(name)) errors.push(`Duplicate column "${name}".`);
    seen.add(name);
  }
  if (table.rows.length < MIN_ROWS) errors.push(`A fit needs at least ${MIN_ROWS} data rows; this table has ${table.rows.length}.`);
  if (table.rows.length > MAX_ROWS) errors.push(`Use at most ${MAX_ROWS} data rows.`);
  for (let r = 0; r < table.rows.length && errors.length < 20; r += 1) {
    const row = table.rows[r];
    if (!Array.isArray(row) || row.length !== table.columns.length) {
      errors.push(`Data row ${r + 1} has the wrong number of cells.`);
      continue;
    }
    for (let c = 0; c < row.length; c += 1) {
      if (typeof row[c] !== 'number' || !Number.isFinite(row[c])) {
        errors.push(`Data row ${r + 1}, column ${table.columns[c]} is not a finite number.`);
      }
    }
  }
  return errors;
}

/** Hash of the normalized table: canonical JSON of {columns, rows}. */
export function normalizedTableHash(table: Table): string {
  return canonicalHash({ columns: table.columns, rows: table.rows });
}
