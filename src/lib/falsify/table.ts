import type { Table } from './types';

export const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

export function columnValues(table: Table, name: string): number[] | null {
  const index = table.columns.indexOf(name);
  if (index < 0) return null;
  return table.rows.map((row) => row[index]);
}

export function validateTable(table: Table): string | null {
  if (table.columns.length < 2 || table.columns.length > 24) return 'Use between 2 and 24 columns.';
  const seen = new Set<string>();
  for (const name of table.columns) {
    if (!IDENTIFIER.test(name)) {
      return `Column "${name}" must start with a letter and use only letters, digits, and underscores.`;
    }
    if (seen.has(name)) return `Duplicate column "${name}".`;
    seen.add(name);
  }
  if (table.rows.length < 8 || table.rows.length > 5000) return 'Use between 8 and 5000 rows.';
  for (let r = 0; r < table.rows.length; r += 1) {
    const row = table.rows[r];
    if (row.length !== table.columns.length) return `Row ${r + 1} has ${row.length} cells.`;
    for (const value of row) {
      if (!Number.isFinite(value)) return `Row ${r + 1} has a non-finite value.`;
    }
  }
  return null;
}
