import { useState, type FormEvent } from 'react';
import { requestModelMenu } from '../lib/api/persist';
import { useAuth } from '../lib/auth';
import { parseCsv } from '../lib/falsify/csv';
import { workshopDemo } from '../lib/falsify/generate';
import { DEFAULT_REPLICATES, buildDeterministicPlan, freezeModelPlan } from '../lib/falsify/planSchema';
import { selectConfounder } from '../lib/falsify/attacks';
import { runAnalysis } from '../lib/falsify/runner';
import { validateTable } from '../lib/falsify/table';
import type { ClaimSpec, Direction, FrozenPlan, Table } from '../lib/falsify/types';
import type { Origin } from '../lib/record';
import { putSession } from '../lib/session';

type Draft = {
  name: string;
  origin: Origin;
  table: Table;
  statement: string;
  outcome: string;
  predictor: string;
  direction: Direction;
  confounder: string;
};

export function NewAnalysisPage() {
  const auth = useAuth();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [seedText, setSeedText] = useState('19019');
  const [alphaText, setAlphaText] = useState('0.05');
  const [planner, setPlanner] = useState<'deterministic' | 'llm'>('deterministic');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function loadDemo() {
    const demo = workshopDemo();
    setDraft({
      name: 'Workshop hours',
      origin: 'demo',
      table: demo.table,
      statement: demo.claim.statement,
      outcome: demo.claim.outcome,
      predictor: demo.claim.predictor,
      direction: demo.claim.direction,
      confounder: demo.claim.confounder ?? '',
    });
    setError(null);
  }

  async function onFile(file: File) {
    const text = await file.text();
    if (text.length > 2_000_000) {
      setError('That file is larger than 2 MB.');
      return;
    }
    const parsed = parseCsv(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const tableError = validateTable(parsed.table);
    if (tableError) {
      setError(tableError);
      return;
    }
    const [predictor, outcome] = parsed.table.columns;
    setDraft({
      name: file.name.replace(/\.(csv|txt)$/i, '').slice(0, 120) || 'Uploaded table',
      origin: 'upload',
      table: parsed.table,
      statement: '',
      outcome,
      predictor,
      direction: 'positive',
      confounder: '',
    });
    setError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setError(null);
    const seed = Number(seedText);
    const alpha = Number(alphaText);
    const claim: ClaimSpec = {
      statement: draft.statement,
      outcome: draft.outcome,
      predictor: draft.predictor,
      direction: draft.direction,
      confounder: draft.confounder || null,
    };
    setBusy(true);
    let plan: FrozenPlan;
    if (planner === 'llm') {
      const menu = await requestModelMenu({
        columns: draft.table.columns,
        rowCount: draft.table.rows.length,
        statement: claim.statement,
        outcome: claim.outcome,
        predictor: claim.predictor,
        direction: claim.direction,
        confounder: claim.confounder,
        autoConfounder: selectConfounder(draft.table, claim),
        seed,
        alpha,
      });
      if (!menu.ok) {
        setBusy(false);
        setError(menu.error);
        return;
      }
      const frozen = freezeModelPlan(menu.menu.attacks, {
        table: draft.table,
        claim,
        seed,
        alpha,
        placeboReplicates: DEFAULT_REPLICATES,
        rationale: menu.menu.rationale,
      });
      if (!frozen.ok) {
        setBusy(false);
        setError(frozen.error);
        return;
      }
      plan = frozen.plan;
    } else {
      const built = buildDeterministicPlan(draft.table, claim, { seed, alpha, placeboReplicates: DEFAULT_REPLICATES });
      if (!built.ok) {
        setBusy(false);
        setError(built.error);
        return;
      }
      plan = built.plan;
    }
    const run = runAnalysis(draft.table, plan);
    const id = `local-${crypto.randomUUID()}`;
    putSession({
      id,
      createdAt: new Date().toISOString(),
      datasetName: draft.name,
      origin: draft.origin,
      table: draft.table,
      claim,
      run,
      saved: false,
      shareToken: null,
      isShared: false,
    });
    setBusy(false);
    window.location.hash = `#/analyses/${encodeURIComponent(id)}`;
  }

  return (
    <section>
      <h1>New run</h1>
      <div className="actions">
        <button type="button" onClick={loadDemo}>Load the workshop demo</button>
        <label className="button secondary">
          Upload a numeric CSV
          <input
            className="file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </label>
      </div>
      <p className="muted">
        The workshop table is synthetic. Prior score drives both hours and the final score. The claim says hours raise the score.
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {draft ? (
        <form className="stack" onSubmit={(event) => void onSubmit(event)}>
          <p className="muted">{draft.table.rows.length} rows, {draft.table.columns.join(', ')}</p>
          <label>
            Claim
            <textarea value={draft.statement} onChange={(event) => setDraft({ ...draft, statement: event.target.value })} maxLength={500} required />
          </label>
          <div className="form-grid">
            <label>
              Predictor
              <select value={draft.predictor} onChange={(event) => setDraft({ ...draft, predictor: event.target.value })}>
                {draft.table.columns.map((column) => <option key={column}>{column}</option>)}
              </select>
            </label>
            <label>
              Outcome
              <select value={draft.outcome} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })}>
                {draft.table.columns.map((column) => <option key={column}>{column}</option>)}
              </select>
            </label>
            <label>
              Direction
              <select value={draft.direction} onChange={(event) => setDraft({ ...draft, direction: event.target.value as Direction })}>
                <option value="positive">positive</option>
                <option value="negative">negative</option>
                <option value="nonzero">nonzero</option>
              </select>
            </label>
            <label>
              Named confounder
              <select value={draft.confounder} onChange={(event) => setDraft({ ...draft, confounder: event.target.value })}>
                <option value="">Choose from the columns</option>
                {draft.table.columns.map((column) => <option key={column}>{column}</option>)}
              </select>
            </label>
            <label>
              Seed
              <input value={seedText} onChange={(event) => setSeedText(event.target.value)} inputMode="numeric" required />
            </label>
            <label>
              Alpha
              <input value={alphaText} onChange={(event) => setAlphaText(event.target.value)} inputMode="decimal" required />
            </label>
          </div>
          <fieldset>
            <legend>Planner</legend>
            <label>
              <input type="radio" name="planner" checked={planner === 'deterministic'} onChange={() => setPlanner('deterministic')} />
              Deterministic menu
            </label>
            <label>
              <input type="radio" name="planner" checked={planner === 'llm'} onChange={() => setPlanner('llm')} />
              Model menu (needs a signed-in account and XAI_API_KEY)
            </label>
            {planner === 'llm' && !auth.email ? <p className="muted">Sign in first. A missing key returns an error and does not invent a menu.</p> : null}
          </fieldset>
          <button type="submit" disabled={busy}>{busy ? 'Running…' : 'Freeze the menu and run it'}</button>
        </form>
      ) : null}
    </section>
  );
}
