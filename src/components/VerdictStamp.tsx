import type { Verdict } from '../lib/falsify/types';

const LABEL: Record<Verdict, string> = {
  falsified: 'Falsified',
  survived: 'Survived',
  unsupported: 'Unsupported',
};

export function VerdictStamp({ verdict }: { verdict: Verdict }) {
  return <p className={`stamp stamp-${verdict}`}>{LABEL[verdict]}</p>;
}
