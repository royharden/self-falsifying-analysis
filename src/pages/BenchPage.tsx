import { useEffect, useRef, useState } from 'react';
import { engineSourceDigest } from '../lib/engineSource';
import { DEFAULT_MANIFEST, summarize, wilson, type CaseResult, type CampaignReport } from '../lib/falsify/evaluate';
import { FAMILIES, type CaseSpec, type Family } from '../lib/falsify/generate';
import { formatNumber } from '../lib/format';
import { runCampaignInWorker, type CampaignHandle } from '../lib/worker/benchClient';

const FAMILY_LABEL: Record<Family, string> = {
  real_adjusted: 'Real effect (β = 2δ), covariate observed',
  real_weak: 'Weak real effect (β = δ/2)',
  real_boundary: 'Boundary effect (β = δ)',
  confounded_observed: 'Confounded, no effect, covariate observed',
  null: 'Null: no association',
  outlier_contamination: 'Real effect with 2% planted outliers',
  unobserved_confounding: 'Confounded, covariate hidden',
  stress_heavy_tail: 'Stress: heavy-tailed errors (out of assumption)',
  stress_near_collinear: 'Stress: near-collinear x and z',
};

/** Up to the browser cap: cycle families/ratios over development seeds, positive claims. */
function selectCases(families: Family[], n: number, cap: number): CaseSpec[] {
  const cells = families.flatMap((family) => DEFAULT_MANIFEST.families[family].ratios.map((ratio) => ({ family, ratio })));
  const specs: CaseSpec[] = [];
  for (let k = 0; specs.length < cap && cells.length > 0 && k < DEFAULT_MANIFEST.splits.development.count; k += 1) {
    for (const cell of cells) {
      if (specs.length >= cap) break;
      specs.push({ family: cell.family, ratio: cell.ratio, n, sign: 1, seed: DEFAULT_MANIFEST.splits.development.start + k });
    }
  }
  return specs;
}

export function BenchPage() {
  const [families, setFamilies] = useState<Family[]>(['real_adjusted', 'confounded_observed', 'null', 'unobserved_confounding']);
  const [n, setN] = useState(200);
  const [results, setResults] = useState<CaseResult[]>([]);
  const [planned, setPlanned] = useState<CaseSpec[]>([]);
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'cancelled' | 'done'>('idle');
  const handle = useRef<CampaignHandle | null>(null);

  useEffect(() => () => handle.current?.cancel(), []);

  function start() {
    const specs = selectCases(families, n, DEFAULT_MANIFEST.browserCaseCap);
    setPlanned(specs);
    setResults([]);
    setReport(null);
    setStatus('running');
    const running = runCampaignInWorker(specs, engineSourceDigest, setResults);
    handle.current = running;
    void running.done.then(({ results: finished, cancelled }) => {
      setStatus(cancelled ? 'cancelled' : 'done');
      setReport(summarize(finished, DEFAULT_MANIFEST, 'development', engineSourceDigest, specs.length));
    });
  }

  return (
    <section>
      <h1>Seeded benchmark</h1>
      <p>
        Synthetic iid families with a known structural slope, analysed under the same frozen policy as the app (δ = {DEFAULT_MANIFEST.delta}{' '}
        per unit, {DEFAULT_MANIFEST.permutations} permutations). The guided arm declares the scenario’s covariate (oracle-assisted); the naive arm is
        unadjusted two-sided p &lt; 0.05 with the claimed sign, a different decision rule. This browser run is capped at {DEFAULT_MANIFEST.browserCaseCap} development cases; the full
        and held-out campaigns run only through <code>npm run eval</code>.
      </p>
      <fieldset>
        <legend>Families</legend>
        {FAMILIES.map((family) => (
          <label key={family}>
            <input
              type="checkbox"
              checked={families.includes(family)}
              disabled={status === 'running'}
              onChange={(event) => setFamilies(event.target.checked ? [...families, family] : families.filter((item) => item !== family))}
            />
            {FAMILY_LABEL[family]}
          </label>
        ))}
      </fieldset>
      <div className="actions">
        <label>
          Rows per case
          <select value={n} disabled={status === 'running'} onChange={(event) => setN(Number(event.target.value))}>
            {DEFAULT_MANIFEST.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button type="button" disabled={status === 'running' || families.length === 0} onClick={start}>Run up to {DEFAULT_MANIFEST.browserCaseCap} cases</button>
        {status === 'running' ? <button type="button" className="secondary" onClick={() => handle.current?.cancel()}>Cancel</button> : null}
      </div>
      {status !== 'idle' ? <p role="status">{results.length} of {planned.length} cases{status === 'cancelled' ? ' — cancelled; the running case counts as failed, unstarted cases were not attempted' : status === 'done' ? ' — done' : '…'}</p> : null}

      {report ? (
        <>
          <h2>Summary ({report.attemptedCases} attempted of {report.expectedCases} planned)</h2>
          <p className="muted">Every attempted case stays in its denominator, including failures. Rates show Wilson 95% intervals. These are a few seeded cases, not the benchmark result.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Family</th><th>β/δ</th><th>Cases</th><th>Failed</th><th>Challenged</th><th>Not challenged</th><th>Inconclusive / limited</th><th>Naive support</th><th>Median |adj − β|</th></tr>
              </thead>
              <tbody>
                {report.cells.map((cell) => (
                  <tr key={`${cell.family}-${cell.ratio}-${cell.n}-${cell.sign}`}>
                    <td>{cell.family}</td><td>{cell.ratio}</td><td>{cell.attempted}</td><td>{cell.guidedFailed}</td>
                    <td>{rate(cell.primaryChallenge)}</td><td>{rate(cell.notChallenged)}</td><td>{rate(cell.inconclusive)}</td>
                    <td>{rate(cell.naiveSupport)}</td><td>{formatNumber(cell.adjustedAbsError.median)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {results.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption>Cases</caption>
            <thead><tr><th>Family</th><th>Seed</th><th>Structural β</th><th>Headline</th><th>Primary estimate</th><th>Naive</th></tr></thead>
            <tbody>
              {results.map((item, index) => (
                <tr key={index}>
                  <td>{item.spec.family}</td><td>{item.spec.seed}</td><td>{formatNumber(item.structuralSlope)}</td>
                  <td>{item.guided.ok ? item.guided.headline : `failed: ${item.guided.reason}`}</td>
                  <td>{item.guided.ok ? formatNumber(item.guided.primaryEstimate) : '—'}</td>
                  <td>{item.naive.ok ? (item.naive.support ? 'support' : 'no support') : 'failed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function rate(value: ReturnType<typeof wilson>): string {
  if (value.rate === null || !value.wilson95) return '—';
  return `${value.k}/${value.n} [${(value.wilson95[0] * 100).toFixed(0)}–${(value.wilson95[1] * 100).toFixed(0)}%]`;
}
