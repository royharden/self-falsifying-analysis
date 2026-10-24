import { useEffect, useState } from 'react';
import { SavedList } from '../components/SavedList';
import { assess } from '../lib/assess';
import { listSession, subscribeSession } from '../lib/session';

export function HomePage() {
  const [, setTick] = useState(0);
  useEffect(() => subscribeSession(() => setTick((value) => value + 1)), []);
  const local = listSession().filter((record) => record.persistence.kind === 'local');

  return (
    <section>
      <h1>State a claim, freeze how to challenge it, then let anyone rerun the challenge.</h1>
      <p>
        You declare a directional association, a practical threshold δ and at most one covariate you assert is a pre-exposure
        common cause — before any number is computed. A deterministic engine then runs a baseline fit, the primary adjustment and
        three secondary diagnostics. Every check, including the failed and the inapplicable ones, stays in the record with its
        recipe and the exact kernel source, and any reader can rerun it and compare every field.
      </p>
      <div className="actions">
        <a className="button" href="#/new">Start with the workshop demo</a>
        <a className="button secondary" href="#/bench">Seeded benchmark</a>
      </div>
      <p className="muted">
        This is a conditional-association check under declared assumptions, not causal proof. Unobserved confounding, the covariate’s
        causal role and prior claim selection are not tested.
      </p>
      <h2>In this browser tab</h2>
      {local.length === 0 ? (
        <p className="muted">No unsaved analysis yet. Local work is lost on reload unless exported or saved.</p>
      ) : (
        <ul className="index">
          {local.map((record) => (
            <li key={record.id}>
              <a href={`#/analyses/${encodeURIComponent(record.id)}`}>“{record.protocol.claim.statement}”</a>
              <span>{assess(record).headline?.title ?? 'not run'}</span>
            </li>
          ))}
        </ul>
      )}
      <SavedList />
    </section>
  );
}
