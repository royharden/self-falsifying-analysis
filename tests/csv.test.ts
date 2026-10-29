import { describe, expect, it } from 'vitest';
import { sha256Bytes } from '../src/lib/falsify/canonical';
import { parseCsvBytes } from '../src/lib/falsify/csv';
import { normalizeHeader } from '../src/lib/falsify/table';

const encode = (text: string) => new TextEncoder().encode(text);

function rows(count: number, make: (i: number) => string): string {
  return Array.from({ length: count }, (_, i) => make(i)).join('\n');
}

describe('header normalization', () => {
  it('follows the documented algorithm', () => {
    expect(normalizeHeader('  Final score (%) ')).toBe('Final_score');
    expect(normalizeHeader('2024 hours')).toBe('col_2024_hours');
    expect(normalizeHeader('__a__b__')).toBe('a__b');
    expect(normalizeHeader('***')).toBeNull();
    expect(normalizeHeader('a'.repeat(42))).toBeNull();
  });
});

describe('strict CSV', () => {
  it('parses quoted cells, strips only a leading BOM and hashes the original bytes', () => {
    const text = `﻿"hours","final score"\n${rows(40, (i) => `"${i}",${i * 2}.5`)}\n`;
    const bytes = encode(text);
    const parsed = parseCsvBytes(bytes, 'demo.csv');
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(parsed.table.columns).toEqual(['hours', 'final_score']);
    expect(parsed.headerMap[1]).toEqual({ source: 'final score', id: 'final_score' });
    expect(parsed.table.rows).toHaveLength(40);
    expect(parsed.table.rows[0]).toEqual([0, 0.5]);
    expect(parsed.source.originalHash).toBe(sha256Bytes(bytes));
  });

  it('accepts escaped quotes inside a quoted header and preserves zeros', () => {
    const parsed = parseCsvBytes(encode(`"a ""q""",b\n${rows(40, () => '0,-0')}`), 'q.csv');
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(parsed.headerMap[0].source).toBe('a "q"');
    expect(parsed.table.rows[0]).toEqual([0, 0]);
  });

  it('rejects colliding normalized headers instead of suffixing', () => {
    const parsed = parseCsvBytes(encode(`a b,a-b\n${rows(40, () => '1,2')}`), 'c.csv');
    expect(parsed.ok).toBe(false);
  });

  it('reports empty cells, junk, NaN, infinity and ragged rows with row and column', () => {
    const cell = (i: number) =>
      i === 3 ? '1,' : i === 5 ? 'abc,1' : i === 7 ? 'NaN,1' : i === 9 ? '1e999,1' : i === 11 ? '1,2,3' : '1,2';
    const parsed = parseCsvBytes(encode(`x,y\n${rows(40, cell)}`), 'bad.csv');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const all = parsed.errors.join('\n');
    expect(all).toMatch(/Data row 4 .*column y is empty/);
    expect(all).toMatch(/Data row 6 .*not a number/);
    expect(all).toMatch(/Data row 8 .*not a number/);
    expect(all).toMatch(/Data row 10 .*non-finite/);
    expect(all).toMatch(/Data row 12 .*3 cells/);
  });

  it('enforces the byte, row and minimum-row limits', () => {
    expect(parseCsvBytes(new Uint8Array(1_048_577), 'big.csv').ok).toBe(false);
    expect(parseCsvBytes(encode(`x,y\n${rows(39, () => '1,2')}`), 'small.csv').ok).toBe(false);
    expect(parseCsvBytes(encode(`x,y\n${rows(5001, () => '1,2')}`), 'many.csv').ok).toBe(false);
  });

  it('rejects stray quotes and unterminated quoted cells', () => {
    expect(parseCsvBytes(encode('x,y\n1"2,3\n'), 's.csv').ok).toBe(false);
    expect(parseCsvBytes(encode('x,y\n"1,2\n'), 'u.csv').ok).toBe(false);
  });
});
