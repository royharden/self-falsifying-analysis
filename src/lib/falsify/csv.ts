import { IDENTIFIER } from './table';
import type { Table } from './types';

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseCsv(text: string): { ok: true; table: Table } | { ok: false; error: string } {
  const rows = parseRows(text.replace(/^\uFEFF/, '')).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (rows.length < 2) return { ok: false, error: 'The CSV needs a header and at least one data row.' };
  const headers = rows[0].map(cleanHeader);
  if (headers.some((header) => header === null)) {
    return {
      ok: false,
      error: 'Each header must start with a letter. Spaces become underscores. Other characters are rejected.',
    };
  }
  const columns = headers as string[];
  const seen = new Set<string>();
  for (const column of columns) {
    if (!IDENTIFIER.test(column)) return { ok: false, error: `Header "${column}" is not a usable column name.` };
    if (seen.has(column)) return { ok: false, error: `Duplicate header "${column}".` };
    seen.add(column);
  }
  const data: number[][] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    if (cells.length !== columns.length) {
      return { ok: false, error: `Row ${r + 1} has ${cells.length} cells, expected ${columns.length}.` };
    }
    const values: number[] = [];
    for (let c = 0; c < cells.length; c += 1) {
      const cell = cells[c].trim();
      if (!NUMBER.test(cell)) {
        return { ok: false, error: `Row ${r + 1}, column ${columns[c]} is not a finite number.` };
      }
      const value = Number(cell);
      if (!Number.isFinite(value)) {
        return { ok: false, error: `Row ${r + 1}, column ${columns[c]} is not a finite number.` };
      }
      values.push(value);
    }
    data.push(values);
  }
  if (data.length > 5000) return { ok: false, error: 'Use at most 5000 data rows.' };
  return { ok: true, table: { columns, rows: data } };
}

function cleanHeader(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, '_');
  if (!IDENTIFIER.test(name)) return null;
  return name;
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
