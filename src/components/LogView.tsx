import { formatKind, formatNumber } from '../lib/format';
import type { AnalysisRecord } from '../lib/record';
import { VerdictStamp } from './VerdictStamp';

export function LogView({
  record,
  attemptHref,
}: {
  record: AnalysisRecord;
  attemptHref: (ordinal: number) => string;
}) {
  const { run } = record;
  return (
    <article>
      <p className="kicker">{record.datasetName}</p>
      <h1>{record.claim.statement}</h1>
      <VerdictStamp verdict={run.verdict} />
      <p>{run.summary}</p>
      <p className="muted">
        {run.plan.planner === 'llm' ? 'Model menu, frozen before execution.' : 'Deterministic menu, frozen before execution.'}
        {' '}Seed {run.plan.seed}. Alpha {run.plan.alpha}. {run.attempts.length} attempts.
        {' '}Outcome {record.claim.outcome}, predictor {record.claim.predictor}, direction {record.claim.direction}.
      </p>
      {run.plan.rationale ? <p className="note">Planner note, not a result: {run.plan.rationale}</p> : null}
      <dl className="metrics">
        <div>
          <dt>Fisher combination</dt>
          <dd>{formatNumber(run.fisherP, 4)}</dd>
        </div>
        <div>
          <dt>Descriptive e product</dt>
          <dd>
            {formatNumber(run.eProduct, 3)}
            {run.eProductCapped ? ' (capped)' : ''}
          </dd>
        </div>
      </dl>
      <p className="muted">
        The e product multiplies a p-to-e calibrator across robustness attacks on this same table.
        The attacks are dependent, so the product is not a Type-I error guarantee.
      </p>
      {run.adjusted.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption>Benjamini-Hochberg adjusted p-values for attacks that produced one</caption>
            <thead>
              <tr>
                <th>Attack</th>
                <th>p</th>
                <th>Adjusted</th>
              </tr>
            </thead>
            <tbody>
              {run.adjusted.map((item) => (
                <tr key={`${item.ordinal}-${item.kind}`}>
                  <td>{formatKind(item.kind)}</td>
                  <td>{formatNumber(item.p)}</td>
                  <td>{formatNumber(item.adjusted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="table-wrap">
        <table>
          <caption>Attempt log</caption>
          <thead>
            <tr>
              <th>#</th>
              <th>Attack</th>
              <th>Estimate</th>
              <th>p</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {run.attempts.map((attempt) => (
              <tr key={attempt.ordinal}>
                <td>{attempt.ordinal + 1}</td>
                <td><a href={attemptHref(attempt.ordinal)}>{formatKind(attempt.kind)}</a></td>
                <td>{formatNumber(attempt.estimate)}</td>
                <td>{formatNumber(attempt.pValue)}</td>
                <td>{attempt.error ? 'Could not run' : attempt.undermines ? 'Overturns' : attempt.supportsClaim ? 'Holds' : 'No effect'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
