import { useState, type FormEvent } from 'react';
import { saveCampaign } from '../lib/api/persist';
import { useAuth } from '../lib/auth';
import { runCampaign, type CampaignReport } from '../lib/falsify/evaluate';
import { formatNumber } from '../lib/format';

export function BenchPage() {
  const auth = useAuth();
  const [seedText, setSeedText] = useState('19019');
  const [replicatesText, setReplicatesText] = useState('3');
  const [rowsText, setRowsText] = useState('120');
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNote(null);
    setBusy(true);
    const result = runCampaign({
      seed: Number(seedText),
      replicates: Number(replicatesText),
      rowsPerCase: Number(rowsText),
    });
    if ('error' in result) {
      setBusy(false);
      setReport(null);
      setError(result.error);
      return;
    }
    setReport(result);
    if (auth.email) {
      const saved = await saveCampaign({
        seed: result.seed,
        replicates: result.replicates,
        rowsPerCase: result.rowsPerCase,
        scores: {
          realKept: result.realKept,
          realTotal: result.realTotal,
          spuriousRejected: result.spuriousRejected,
          spuriousTotal: result.spuriousTotal,
          noiseQuiet: result.noiseQuiet,
          noiseTotal: result.noiseTotal,
          falsePositives: result.falsePositives,
        },
        cases: result.cases,
      });
      setNote(saved.ok ? 'Bench report saved to your account.' : saved.error);
    }
    setBusy(false);
  }

  return (
    <section>
      <h1>Planted-effect bench</h1>
      <p>
        Each replicate builds three tables from the seed: pure noise, a real slope of 0.8, and a spurious
        association created by a shared latent column. The deterministic agent then attacks the claim “x raises y.”
      </p>
      <form className="form-grid" onSubmit={(event) => void onSubmit(event)}>
        <label>Seed<input value={seedText} onChange={(event) => setSeedText(event.target.value)} /></label>
        <label>Replicates<input value={replicatesText} onChange={(event) => setReplicatesText(event.target.value)} /></label>
        <label>Rows per case<input value={rowsText} onChange={(event) => setRowsText(event.target.value)} /></label>
        <button type="submit" disabled={busy}>{busy ? 'Scoring…' : 'Run the bench'}</button>
      </form>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {note ? <p role="status">{note}</p> : null}
      {report ? (
        <>
          <dl className="metrics">
            <div><dt>Real effect kept</dt><dd>{report.realKept}/{report.realTotal}</dd></div>
            <div><dt>Spurious rejected</dt><dd>{report.spuriousRejected}/{report.spuriousTotal}</dd></div>
            <div><dt>Noise kept quiet</dt><dd>{report.noiseQuiet}/{report.noiseTotal}</dd></div>
            <div><dt>False survivals</dt><dd>{report.falsePositives}</dd></div>
          </dl>
          <div className="table-wrap">
            <table>
              <caption>Cases. Placebo shuffles in the bench: {report.placeboReplicates}.</caption>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Verdict</th>
                  <th>Naive slope</th>
                  <th>Partial slope</th>
                </tr>
              </thead>
              <tbody>
                {report.cases.map((item) => (
                  <tr key={`${item.kind}-${item.seed}`}>
                    <td>{item.kind}</td>
                    <td>{item.verdict}</td>
                    <td>{formatNumber(item.naiveSlope)}</td>
                    <td>{formatNumber(item.partialSlope)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
