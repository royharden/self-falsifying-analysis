import type { Assessment } from '../lib/assess';
import { LIMITATION_TEXT } from '../lib/falsify/aggregate';
import { executionOrder } from '../lib/falsify/planSchema';
import { RECIPE_TITLES } from '../lib/falsify/sourceText';
import { formatKind, formatNumber, shortHash } from '../lib/format';
import type { AnalysisRecord } from '../lib/record';
import { safeAttemptSentence } from '../lib/templates';
import { IntervalChart } from './IntervalChart';
import { VerdictStamp } from './VerdictStamp';

export function LogView({
  record,
  assessment,
  attemptHref,
}: {
  record: AnalysisRecord;
  assessment: Assessment;
  attemptHref: (ordinal: number) => string;
}) {
  const { protocol } = record;
  const { claim } = protocol;
  const unit = `${claim.yUnits} per ${claim.xUnits}`;
  const execution = assessment.execution;
  const grounded = assessment.integrityErrors.length === 0;
  return (
    <article>
      <p className="kicker">{record.datasetName}</p>
      <h1 className="claim">“{claim.statement}”</h1>
      {assessment.headline ? <VerdictStamp headline={assessment.headline} /> : null}
      {!execution ? <p className="note">Protocol frozen. The engine has not run yet.</p> : null}
      {execution?.status === 'running' ? <p className="note">Running…</p> : null}
      {assessment.integrityErrors.length > 0 ? (
        <div className="error" role="alert">
          <p>Integrity check failed; no headline is generated from this record.</p>
          <ul>
            {assessment.integrityErrors.slice(0, 8).map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      ) : null}

      {protocol.parentAnalysisId ? (
        <p className="note">
          Revision of an earlier analysis, frozen after its results could be seen. Treat it as exploration, not as an independent test.
        </p>
      ) : null}

      <dl className="protocol">
        <div><dt>Predictor → outcome</dt><dd>{claim.x} → {claim.y} ({claim.direction})</dd></div>
        <div><dt>Practical threshold</dt><dd>δ = {formatNumber(claim.delta)} {unit}</dd></div>
        <div>
          <dt>Primary adjustment</dt>
          <dd>{claim.z ? `${claim.z} — asserted by the user as a pre-exposure common cause` : 'None — the user declared no defensible covariate'}</dd>
        </div>
        <div><dt>Rows</dt><dd>{protocol.dataset.rowCount} (iid assumed by the user, not checked)</dd></div>
        <div><dt>Seed / permutations</dt><dd>{protocol.seed} / {protocol.permutations}</dd></div>
        <div><dt>Policy / engine</dt><dd>{protocol.policyId} v{protocol.policyVersion} / {protocol.engineVersion}</dd></div>
        <div><dt>Protocol hash</dt><dd><code>{shortHash(record.protocolHash)}</code></dd></div>
        <div><dt>Data hash</dt><dd><code>{shortHash(protocol.dataset.normalizedHash)}</code></dd></div>
        <div><dt>Kernel source digest</dt><dd><code>{shortHash(protocol.engineSourceDigest)}</code></dd></div>
      </dl>

      {grounded && execution ? (
        <IntervalChart
          rows={[
            { label: 'Baseline', ordinal: 0 },
            { label: claim.z ? `Adjusted for ${claim.z}` : 'Primary (none)', ordinal: 1 },
          ]}
          book={assessment.book}
          delta={claim.delta}
          unit={unit}
        />
      ) : null}

      {execution ? (
        <section className="attempts">
          <h2>Every planned check</h2>
          <ol className="attempt-list">
            {executionOrder(protocol).map((ordinal) => {
              const attempt = execution.attempts.find((item) => item.ordinal === ordinal);
              const kind = protocol.recipes[ordinal].kind;
              return (
                <li key={ordinal} className={`attempt attempt-${attempt?.outcome ?? 'pending'}`}>
                  <a href={attemptHref(ordinal)}>{RECIPE_TITLES[kind]}</a>
                  <span className="outcome">{attempt ? formatKind(attempt.outcome) : execution.status === 'running' ? 'pending' : 'missing'}</span>
                  {attempt && grounded ? <p>{safeAttemptSentence(attempt, assessment.book, protocol)}</p> : null}
                </li>
              );
            })}
          </ol>
          {assessment.headline ? (
            <p className="muted">
              Coverage: {assessment.headline.coverage.planned} planned, {assessment.headline.coverage.completed} completed,{' '}
              {assessment.headline.coverage.noFlag} no flag, {assessment.headline.coverage.flagged} flagged,{' '}
              {assessment.headline.coverage.inapplicable} inapplicable, {assessment.headline.coverage.error} error,{' '}
              {assessment.headline.coverage.cancelled} cancelled, {assessment.headline.coverage.interrupted} interrupted.
              {' '}Secondary diagnostics never change the headline.
            </p>
          ) : null}
        </section>
      ) : null}

      <p className="limitation">{LIMITATION_TEXT}</p>
    </article>
  );
}
