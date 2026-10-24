import { useMemo, useState } from 'react';
import { formatKind, formatNumber } from '../lib/format';
import { attemptsMatch, rerunProgram } from '../lib/falsify/runner';
import type { AnalysisRecord } from '../lib/record';
import type { AttemptResult } from '../lib/falsify/types';

export function AttemptPage({
  record,
  ordinal,
  backHref,
}: {
  record: AnalysisRecord;
  ordinal: number;
  backHref: string;
}) {
  const stored = record.run.attempts.find((attempt) => attempt.ordinal === ordinal) ?? null;
  const [rerun, setRerun] = useState<AttemptResult | null>(null);

  const match = useMemo(() => (stored && rerun ? attemptsMatch(stored, rerun, 1e-6) : null), [stored, rerun]);

  if (!stored) {
    return (
      <section>
        <p><a href={backHref}>Back to the log</a></p>
        <p className="error" role="alert">That attempt is not in this log.</p>
      </section>
    );
  }

  return (
    <section>
      <p><a href={backHref}>Back to the log</a></p>
      <h1>{formatKind(stored.kind)}</h1>
      <p>{stored.reason}</p>
      <dl className="metrics">
        <div><dt>Estimate</dt><dd>{formatNumber(stored.estimate)}</dd></div>
        <div><dt>Std. error</dt><dd>{formatNumber(stored.standardError)}</dd></div>
        <div><dt>p</dt><dd>{formatNumber(stored.pValue)}</dd></div>
        <div><dt>Rows</dt><dd>{stored.n}</dd></div>
      </dl>
      <h2>Program</h2>
      <pre className="source">{stored.sourceText}</pre>
      <button type="button" onClick={() => setRerun(rerunProgram(record.table, record.run.plan, ordinal))}>
        Rerun this program
      </button>
      {rerun ? (
        <div>
          <h2>Rerun</h2>
          <p>{match ? 'Rerun matches the stored attempt.' : 'Rerun differs from the stored attempt.'}</p>
          <dl className="metrics">
            <div><dt>Estimate</dt><dd>{formatNumber(rerun.estimate)}</dd></div>
            <div><dt>p</dt><dd>{formatNumber(rerun.pValue)}</dd></div>
            <div><dt>Overturns</dt><dd>{rerun.undermines ? 'yes' : 'no'}</dd></div>
          </dl>
          {rerun.error ? <p className="error" role="alert">{rerun.error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
