import { useMemo, useState } from 'react';
import { assess } from '../lib/assess';
import { engineSourceDigest, kernelFiles } from '../lib/engineSource';
import { canonicalJson } from '../lib/falsify/canonical';
import { diffAttempts } from '../lib/falsify/grounding';
import { recipeHash } from '../lib/falsify/planSchema';
import { RECIPE_PROCEDURES, RECIPE_TITLES } from '../lib/falsify/sourceText';
import { formatKind, shortHash } from '../lib/format';
import { originalExecution, type AnalysisRecord } from '../lib/record';
import { launch } from '../lib/runs';
import { safeAttemptSentence } from '../lib/templates';

export function AttemptPage({ record, ordinal, backHref }: { record: AnalysisRecord; ordinal: number; backHref: string }) {
  const assessment = useMemo(() => assess(record), [record]);
  const [rerunId, setRerunId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const recipe = record.protocol.recipes[ordinal];
  if (!recipe) {
    return (
      <section>
        <p><a href={backHref}>Back to the analysis</a></p>
        <p className="error" role="alert">There is no recipe {ordinal} in this protocol.</p>
      </section>
    );
  }
  const original = originalExecution(record);
  const stored = original?.attempts.find((attempt) => attempt.ordinal === ordinal) ?? null;
  const sameKernel = record.protocol.engineSourceDigest === engineSourceDigest;
  const grounded = assessment.integrityErrors.length === 0;
  const canReplay = sameKernel && grounded && original !== null && original.status !== 'running';
  const rerunExecution = rerunId ? record.executions.find((execution) => execution.executionId === rerunId) ?? null : null;
  const rerun = rerunExecution?.attempts.find((attempt) => attempt.ordinal === ordinal) ?? null;
  const diffs = stored && rerun ? diffAttempts(stored, rerun) : null;

  return (
    <section>
      <p><a href={backHref}>Back to the analysis</a></p>
      <p className="kicker">Recipe {ordinal + 1} · {recipe.role}</p>
      <h1>{RECIPE_TITLES[recipe.kind]}</h1>
      <p>{RECIPE_PROCEDURES[recipe.kind]}</p>

      <h2>Stored result</h2>
      {stored ? (
        <>
          <p><strong>{formatKind(stored.outcome)}</strong> — {stored.reason}</p>
          {grounded ? <p>{safeAttemptSentence(stored, assessment.book, record.protocol)}</p> : <p className="error">Integrity check failed; numbers are shown raw below but no summary is generated.</p>}
          <details>
            <summary>Full terminal record (payload hash <code>{shortHash(stored.payloadHash)}</code>)</summary>
            <pre className="source">{JSON.stringify(stored, null, 2)}</pre>
          </details>
        </>
      ) : (
        <p className="muted">{original ? 'No terminal record for this recipe yet.' : 'The protocol has not been run.'}</p>
      )}

      <h2>Frozen recipe</h2>
      <p className="muted">Recipe hash <code>{shortHash(recipeHash(recipe))}</code>, bound to data hash <code>{shortHash(recipe.inputHash)}</code>.</p>
      <pre className="source">{canonicalJson(recipe)}</pre>

      <h2>Kernel source</h2>
      {sameKernel ? (
        <p className="muted">
          This build ships kernel digest <code>{shortHash(engineSourceDigest)}</code>, the digest frozen in the protocol. The text below is the
          exact source this build executes; it is displayed, never evaluated.
        </p>
      ) : (
        <p className="error" role="alert">
          This record was produced by kernel digest <code>{shortHash(record.protocol.engineSourceDigest)}</code>; this build ships{' '}
          <code>{shortHash(engineSourceDigest)}</code>. The record is view-only here: no silent replay on a different engine.
        </p>
      )}
      <button type="button" className="secondary" onClick={() => setShowSource(!showSource)}>
        {showSource ? 'Hide' : 'Show'} kernel source ({kernelFiles.length} files)
      </button>
      {showSource
        ? kernelFiles.map((file) => (
            <details key={file.path}>
              <summary><code>{file.path}</code> sha256 <code>{shortHash(file.sha256)}</code></summary>
              <pre className="source">{file.text}</pre>
            </details>
          ))
        : null}

      <h2>Rerun</h2>
      <p className="muted">Reruns the frozen recipe on the exact rows in this browser. It is linked to the original execution and never issues a new headline.</p>
      <button
        type="button"
        disabled={!canReplay || rerunExecution?.status === 'running'}
        onClick={() => {
          const started = launch(record.id, { kind: 'rerun_one', ordinal });
          if (started) setRerunId(started.executionId);
        }}
      >
        Rerun this recipe
      </button>
      {!canReplay ? <p className="muted">Replay needs a completed original run, a passing integrity check and the same kernel digest.</p> : null}
      {rerunExecution?.status === 'running' ? <p>Running…</p> : null}
      {rerun && diffs ? (
        diffs.length === 0 ? (
          <p className="ok">Every field matches: scientific numbers within |a − b| ≤ 1e-12 + 1e-9·max(|a|, |b|), everything else exactly.</p>
        ) : (
          <div className="error" role="alert">
            <p>{diffs.length} field(s) differ:</p>
            <table className="compact">
              <thead><tr><th>Field</th><th>Stored</th><th>Rerun</th><th>Rule</th></tr></thead>
              <tbody>
                {diffs.map((diff) => (
                  <tr key={diff.path}><td><code>{diff.path}</code></td><td>{diff.stored}</td><td>{diff.rerun}</td><td>{diff.kind}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
