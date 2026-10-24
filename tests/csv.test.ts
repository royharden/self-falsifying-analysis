import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/falsify/csv';

describe('csv', () => {
  it('renames a spaced header and keeps a quoted cell', () => {
    const parsed = parseCsv('hours,"final score"\n"1",2\n');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.table.columns).toEqual(['hours', 'final_score']);
    expect(parsed.table.rows).toEqual([[1, 2]]);
  });

  it('rejects a non-numeric quoted cell and a duplicate header', () => {
    expect(parseCsv('a,b\n"1,5",2\n').ok).toBe(false);
    expect(parseCsv('a,a\n1,2\n').ok).toBe(false);
  });
});
