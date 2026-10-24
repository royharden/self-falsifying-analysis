export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.0001 || abs >= 10000)) return value.toExponential(2);
  return value.toFixed(digits);
}

export function formatKind(kind: string): string {
  return kind.replaceAll('_', ' ');
}
