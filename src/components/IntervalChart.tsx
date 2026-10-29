import type { FactBook } from '../lib/falsify/grounding';
import { formatNumber } from '../lib/format';

type Row = { label: string; ordinal: number };

/**
 * Claimed-direction 95% intervals against delta. Positions and labels come only
 * from validated facts (claimed.L / claimed.U).
 */
export function IntervalChart({ rows, book, delta, unit }: { rows: Row[]; book: FactBook; delta: number; unit: string }) {
  const present = rows.filter((row) => book.has(row.ordinal, 'claimed.L'));
  if (present.length === 0) return null;
  const values = present.flatMap((row) => [book.get(row.ordinal, 'claimed.L').value, book.get(row.ordinal, 'claimed.U').value]);
  let min = Math.min(0, delta, ...values);
  let max = Math.max(delta, ...values);
  const pad = (max - min) * 0.08 || 1;
  min -= pad;
  max += pad;
  const width = 640;
  const left = 150;
  const right = 20;
  const rowHeight = 34;
  const height = present.length * rowHeight + 34;
  const x = (value: number) => left + ((value - min) / (max - min)) * (width - left - right);
  return (
    <figure className="interval-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Claimed-direction 95% intervals against δ = ${formatNumber(delta)} ${unit}`}>
        <line x1={x(0)} x2={x(0)} y1={8} y2={height - 24} className="zero" />
        <line x1={x(delta)} x2={x(delta)} y1={8} y2={height - 24} className="delta" />
        <text x={x(delta)} y={height - 8} textAnchor="middle" className="axis-label">δ {formatNumber(delta)}</text>
        <text x={x(0)} y={height - 8} textAnchor="middle" className="axis-label">0</text>
        {present.map((row, index) => {
          const L = book.get(row.ordinal, 'claimed.L').value;
          const U = book.get(row.ordinal, 'claimed.U').value;
          const y = 22 + index * rowHeight;
          return (
            <g key={row.ordinal}>
              <text x={8} y={y + 4} className="row-label">{row.label}</text>
              <line x1={x(L)} x2={x(U)} y1={y} y2={y} className="interval" />
              <circle cx={x((L + U) / 2)} cy={y} r={4} className="interval-mid" />
              <text x={x(U) + 6} y={y + 4} className="value-label">[{formatNumber(L)}, {formatNumber(U)}]</text>
            </g>
          );
        })}
      </svg>
      <figcaption>Claimed-direction 95% intervals ({unit}). Wholly right of δ: reproduced/retained; wholly left: below δ; touching or crossing: inconclusive.</figcaption>
    </figure>
  );
}
