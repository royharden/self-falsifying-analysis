import { useEffect, useState } from 'react';
import { validateProposal } from '../../supabase/functions/plan-attacks/contract';
import { buildPlannerRequest, plannerUsage, requestProposal } from '../lib/api/planner';
import { useAuth } from '../lib/auth';
import type { ColumnMeta } from '../lib/falsify/generate';
import type { Direction, HeaderMapEntry, SecondaryKind } from '../lib/falsify/types';

export type AcceptedProposal = { covariate: string | null; secondaryOrder: SecondaryKind[]; note: string };

type Claim = { statement: string; x: string; y: string; direction: Direction; deltaText: string; xUnits: string; yUnits: string };

/**
 * Optional paid planner. Sends only the previewed metadata, after explicit consent.
 * The proposal is untrusted text: the user still confirms the covariate role before freezing.
 */
export function PlannerPanel({
  columns,
  rowCount,
  headerMap,
  columnsMeta,
  claim,
  onAccept,
}: {
  columns: string[];
  rowCount: number;
  headerMap: HeaderMapEntry[] | null;
  columnsMeta: ColumnMeta[] | null;
  claim: Claim;
  onAccept: (proposal: AcceptedProposal) => void;
}) {
  const auth = useAuth();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ charged: number; limit: number } | null>(null);
  const [proposal, setProposal] = useState<AcceptedProposal & { rationale: string } | null>(null);

  useEffect(() => {
    if (auth.email) void plannerUsage().then(setUsage);
  }, [auth.email]);

  if (!auth.configured) return null;
  if (!auth.email) return <p className="muted">Optional model planner: <a href="#/login">sign in</a> with a confirmed email to use it.</p>;
  if (!auth.emailVerified) return <p className="muted">Optional model planner: confirm your email address first.</p>;

  const built = buildPlannerRequest({
    requestId,
    columns,
    headerMap,
    columnsMeta,
    rowCount,
    statement: claim.statement,
    x: claim.x,
    y: claim.y,
    direction: claim.direction,
    delta: claim.deltaText.trim() === '' ? Number.NaN : Number(claim.deltaText),
    units: `${claim.yUnits} per ${claim.xUnits}`,
  });

  async function ask() {
    if (!built.ok) return;
    setBusy(true);
    setMessage(null);
    const outcome = await requestProposal(built.text);
    setBusy(false);
    void plannerUsage().then(setUsage);
    if (outcome.kind === 'pending') {
      setMessage(`Outcome unknown (${outcome.status}); the call may already be charged. No proposal was invented.`);
      return;
    }
    if (outcome.kind === 'error') {
      setMessage(outcome.error);
      return;
    }
    if (!built.ok) return;
    const checked = validateProposal(outcome.proposal, built.request);
    if (!checked.ok) {
      setMessage(`The proposal was rejected in the browser: ${checked.error}`);
      return;
    }
    setProposal({
      covariate: checked.proposal.primaryCovariate,
      secondaryOrder: checked.proposal.secondary.map((item) => item.kind),
      note: checked.proposal.secondary.map((item) => `${item.kind}: ${item.note}`).join(' '),
      rationale: checked.proposal.rationale,
    });
  }

  return (
    <details className="planner">
      <summary>Optional: ask the model to propose a covariate and display order (paid, metadata only)</summary>
      {!built.ok ? (
        <p className="muted">Complete the claim, δ and units first ({built.error}).</p>
      ) : (
        <>
          <p className="muted">Exactly this metadata is sent — no rows, values or statistics. Column labels can themselves disclose information.</p>
          <pre className="source">{JSON.stringify(built.request, null, 2)}</pre>
          <label>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            Send this metadata to the model provider through my account{usage ? ` (${usage.charged} of ${usage.limit} calls used today, UTC)` : ''}.
          </label>
          <div className="actions">
            <button type="button" disabled={!consent || busy} onClick={() => void ask()}>{busy ? 'Asking…' : 'Ask for a proposal'}</button>
            <button type="button" className="secondary" onClick={() => { setRequestId(crypto.randomUUID()); setProposal(null); setMessage(null); }}>New request</button>
          </div>
        </>
      )}
      {message ? <p className="error" role="alert">{message}</p> : null}
      {proposal ? (
        <div className="note">
          <p>
            Proposal (untrusted model text, not a fact): {proposal.covariate ? `adjust for ${proposal.covariate}` : 'no defensible covariate (abstained)'}.{' '}
            {proposal.rationale}
          </p>
          <p className="muted">Display order: {proposal.secondaryOrder.join(', ')}. Baseline and primary always run first; δ, seed and budgets are unchanged.</p>
          <button type="button" className="secondary" onClick={() => onAccept(proposal)}>Use this proposal (you still confirm the covariate role)</button>
        </div>
      ) : null}
    </details>
  );
}
