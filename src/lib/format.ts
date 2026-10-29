export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.0001 || abs >= 100000)) return value.toExponential(3);
  return Number(value.toFixed(digits)).toString();
}

export function formatKind(kind: string): string {
  return kind.replaceAll('_', ' ');
}

export function shortHash(hash: string | null | undefined): string {
  return hash ? `${hash.slice(0, 12)}…` : '—';
}
