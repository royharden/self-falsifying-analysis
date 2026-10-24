import { sha256Bytes } from './canonical';
import { MAX_BYTES, MAX_COLUMNS, MAX_ROWS, MIN_COLUMNS, MIN_ROWS, normalizeHeader, normalizedTableHash } from './table';
import type { CsvSource, HeaderMapEntry, Table } from './types';

/** Strict decimal or scientific number. Surrounding spaces/tabs are allowed and ignored. */
export const NUMBER_GRAMMAR = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export type ParsedCsv = {
  ok: true;
  table: Table;
  headerMap: HeaderMapEntry[];
  source: CsvSource;
  normalizedHash: string;
};

export type CsvFailure = { ok: false; errors: string[] };

const MAX_ERRORS = 20;

type RawRow = { line: number; cells: string[] };

/**
 * Parse an uploaded CSV. The source hash binds the original bytes (including any
 * BOM); only a leading UTF-8 BOM is stripped before parsing. No coercion, row
 * dropping, imputation or deduplication.
 */
export function parseCsvBytes(bytes: Uint8Array, fileName: string): ParsedCsv | CsvFailure {
  if (bytes.length > MAX_BYTES) return { ok: false, errors: [`The file is larger than ${MAX_BYTES} bytes.`] };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false, errors: ['The file is not valid UTF-8 text.'] };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const parsed = parseRows(text);
  if ('error' in parsed) return { ok: false, errors: [parsed.error] };
  const rows = parsed.rows;
  while (rows.length > 0 && isBlank(rows[rows.length - 1])) rows.pop();
  if (rows.length === 0) return { ok: false, errors: ['The file is empty.'] };

  const errors: string[] = [];
  const header = rows[0];
  if (header.cells.length < MIN_COLUMNS || header.cells.length > MAX_COLUMNS) {
    errors.push(`Use between ${MIN_COLUMNS} and ${MAX_COLUMNS} columns; the header has ${header.cells.length}.`);
  }
  const headerMap: HeaderMapEntry[] = [];
  const seen = new Map<string, string>();
  header.cells.forEach((raw, index) => {
    const id = normalizeHeader(raw);
    if (id === null) {
      errors.push(`Header ${index + 1} ("${raw}") cannot be turned into a column identifier.`);
      return;
    }
    const previous = seen.get(id);
    if (previous !== undefined) {
      errors.push(`Headers "${previous}" and "${raw}" both normalize to "${id}". Rename one.`);
      return;
    }
    seen.set(id, raw);
    headerMap.push({ source: raw, id });
  });
  if (errors.length > 0) return { ok: false, errors };

  const columns = headerMap.map((entry) => entry.id);
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) return { ok: false, errors: [`Use at most ${MAX_ROWS} data rows; found ${dataRows.length}.`] };
  if (dataRows.length < MIN_ROWS) {
    return { ok: false, errors: [`A fit needs at least ${MIN_ROWS} data rows; found ${dataRows.length}.`] };
  }
  const data: number[][] = [];
  for (let r = 0; r < dataRows.length; r += 1) {
    const { line, cells } = dataRows[r];
    const label = `Data row ${r + 1} (line ${line})`;
    if (cells.length !== columns.length) {
      errors.push(`${label} has ${cells.length} cells, expected ${columns.length}.`);
      if (errors.length >= MAX_ERRORS) break;
      continue;
    }
    const values: number[] = [];
    for (let c = 0; c < cells.length; c += 1) {
      const cell = cells[c].replace(/^[ \t]+|[ \t]+$/g, '');
      if (cell === '') {
        errors.push(`${label}, column ${columns[c]} is empty. Missing values are not supported.`);
      } else if (!NUMBER_GRAMMAR.test(cell)) {
        errors.push(`${label}, column ${columns[c]} is not a number: "${cell.slice(0, 40)}".`);
      } else {
        const value = Number(cell);
        if (!Number.isFinite(value)) errors.push(`${label}, column ${columns[c]} overflows to a non-finite number.`);
        else values.push(value === 0 ? 0 : value);
      }
      if (errors.length >= MAX_ERRORS) break;
    }
    if (errors.length >= MAX_ERRORS) break;
    data.push(values);
  }
  if (errors.length > 0) {
    if (errors.length >= MAX_ERRORS) errors.push('Stopped after the first 20 problems.');
    return { ok: false, errors };
  }
  const table: Table = { columns, rows: data };
  return {
    ok: true,
    table,
    headerMap,
    normalizedHash: normalizedTableHash(table),
    source: {
      kind: 'csv',
      fileName: fileName.slice(0, 200),
      byteLength: bytes.length,
      originalHash: sha256Bytes(bytes),
      headerMap,
    },
  };
}

function isBlank(row: RawRow): boolean {
  return row.cells.length === 1 && row.cells[0] === '';
}

/** RFC 4180 style rows: quoted cells, "" escapes, CRLF/LF/CR line ends. Strict about stray quotes. */
function parseRows(text: string): { rows: RawRow[] } | { error: string } {
  const rows: RawRow[] = [];
  let line = 1;
  let rowLine = 1;
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let quotedCell = false;
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
        if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell.replace(/[ \t]/g, '') !== '' || quotedCell) {
        return { error: `Line ${line}: a quote appears inside an unquoted cell.` };
      }
      cell = '';
      inQuotes = true;
      quotedCell = true;
      continue;
    }
    if (ch === ',') {
      cells.push(cell);
      cell = '';
      quotedCell = false;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cells.push(cell);
      rows.push({ line: rowLine, cells });
      cells = [];
      cell = '';
      quotedCell = false;
      line += 1;
      rowLine = line;
      continue;
    }
    if (quotedCell && ch !== ' ' && ch !== '\t') {
      return { error: `Line ${line}: text follows a closing quote.` };
    }
    if (!quotedCell) cell += ch;
  }
  if (inQuotes) return { error: 'A quoted cell is not closed before the end of the file.' };
  if (cell.length > 0 || cells.length > 0 || quotedCell) {
    cells.push(cell);
    rows.push({ line: rowLine, cells });
  }
  return { rows };
}
