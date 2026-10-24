import type { Headline } from '../lib/falsify/types';

export function VerdictStamp({ headline }: { headline: Headline }) {
  return (
    <div className={`stamp stamp-${headline.code}`} role="status">
      <strong>{headline.title}</strong>
      <span>{headline.reason}</span>
      {headline.scopeNote ? <em>{headline.scopeNote}</em> : null}
    </div>
  );
}
