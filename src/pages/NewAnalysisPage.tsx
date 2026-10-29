import { useEffect, useState, type FormEvent } from 'react';
import { PlannerPanel } from '../components/PlannerPanel';
import { freezeOnServer } from '../lib/api/persist';
import { useAuth } from '../lib/auth';
import { engineSourceDigest } from '../lib/engineSource';
import { parseCsvBytes, type ParsedCsv } from '../lib/falsify/csv';
import { workshopFixture, type Fixture } from '../lib/falsify/generate';
import {
  buildProtocol,
  DEFAULT_PERMUTATIONS,
  DEFAULT_SECONDARY_ORDER,
  DEFAULT_SEED,
  executionOrder,
  MAX_PERMUTATIONS,
  type ClaimDraft,
} from '../lib/falsify/planSchema';
import { RECIPE_PROCEDURES, RECIPE_TITLES } from '../lib/falsify/sourceText';
import { MAX_BYTES } from '../lib/falsify/table';
import type { DatasetIdentity, Direction, HeaderMapEntry, ProtocolV1, SecondaryKind, Table } from '../lib/falsify/types';
import { formatNumber, shortHash } from '../lib/format';
import type { AnalysisRecord } from '../lib/record';
import { clearRevision, putSession, takeRevision } from '../lib/session';

type Source =
  | { kind: 'fixture'; fixture: Fixture }
  | { kind: 'csv'; parsed: ParsedCsv; name: string }
  | { kind: 'revision'; parent: AnalysisRecord };

type Form = {
  statement: string;
  x: string;
  y: string;
  covariateMode: '' | 'asserted' | 'none';
  z: string;
  confirmed: boolean;
  direction: Direction;
  deltaText: string;
  xUnits: string;
  yUnits: string;
  iid: boolean;
  seedText: string;
  permutationsText: string;
};

function tableOf(source: Source): Table {
  if (source.kind === 'revision') return source.parent.table;
  return source.kind === 'fixture' ? source.fixture.table : source.parsed.table;
}

function nameOf(source: Source): string {
  if (source.kind === 'revision') return source.parent.datasetName;
  return source.kind === 'fixture' ? source.fixture.title : source.name;
}

function columnsMetaOf(source: Source) {
  if (source.kind === 'revision') return source.parent.columns;
  return source.kind === 'fixture' ? source.fixture.columns : null;
}

/** Revisions start from the parent's frozen settings; the user must confirm again. */
function formFromParent(parent: AnalysisRecord): Form {
  const { claim } = parent.protocol;
  return {
    statement: claim.statement,
    x: claim.x,
    y: claim.y,
    covariateMode: claim.z ? 'asserted' : 'none',
    z: claim.z ?? '',
    confirmed: false,
    direction: claim.direction,
    deltaText: String(claim.delta),
    xUnits: claim.xUnits,
    yUnits: claim.yUnits,
    iid: false,
    seedText: String(parent.protocol.seed),
    permutationsText: String(parent.protocol.permutations),
  };
}

function datasetOf(source: Source): DatasetIdentity {
  if (source.kind === 'revision') return source.parent.protocol.dataset;
  if (source.kind === 'fixture') return source.fixture.dataset;
  return {
    normalizedHash: source.parsed.normalizedHash,
    rowCount: source.parsed.table.rows.length,
    columnCount: source.parsed.table.columns.length,
    source: source.parsed.source,
  };
}

function headerMapOf(source: Source): HeaderMapEntry[] | null {
  if (source.kind === 'revision') return source.parent.headerMap;
  return source.kind === 'csv' ? source.parsed.headerMap : null;
}

export function NewAnalysisPage() {
  const [parent] = useState<AnalysisRecord | null>(() => takeRevision());
  const [source, setSource] = useState<Source | null>(() => (parent ? { kind: 'revision', parent } : null));
  const [form, setForm] = useState<Form | null>(() => (parent ? formFromParent(parent) : null));
  const [secondaryOrder, setSecondaryOrder] = useState<SecondaryKind[]>(() => parent?.protocol.secondaryOrder ?? DEFAULT_SECONDARY_ORDER);
  const [plannerNote, setPlannerNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ protocol: ProtocolV1; hash: string; key: string } | null>(null);
  const auth = useAuth();
  const [serverFreeze, setServerFreeze] = useState(false);
  const [freezing, setFreezing] = useState(false);

  useEffect(() => () => clearRevision(), []);

  function loadFixture(kind: 'confounded' | 'real') {
    const fixture = workshopFixture(kind);
    const s = fixture.suggestion;
    setSource({ kind: 'fixture', fixture });
    setForm({
      statement: s.statement,
      x: s.x,
      y: s.y,
      covariateMode: 'asserted',
      z: s.z,
      confirmed: false,
      direction: s.direction,
      deltaText: String(s.delta),
      xUnits: s.xUnits,
      yUnits: s.yUnits,
      iid: false,
      seedText: String(DEFAULT_SEED),
      permutationsText: String(DEFAULT_PERMUTATIONS),
    });
    setSecondaryOrder(DEFAULT_SECONDARY_ORDER);
    setPlannerNote(null);
    setPreview(null);
    setErrors([]);
  }

  async function onFile(file: File) {
    setPreview(null);
    if (file.size > MAX_BYTES) {
      setErrors([`That file is ${file.size} bytes; the limit is ${MAX_BYTES} bytes. It was not read.`]);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseCsvBytes(bytes, file.name);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    const [x, y] = parsed.table.columns;
    setSource({ kind: 'csv', parsed, name: file.name });
    setForm({
      statement: '',
      x,
      y,
      covariateMode: '',
      z: '',
      confirmed: false,
      direction: 'positive',
      deltaText: '',
      xUnits: '',
      yUnits: '',
      iid: false,
      seedText: String(DEFAULT_SEED),
      permutationsText: String(DEFAULT_PERMUTATIONS),
    });
    setSecondaryOrder(DEFAULT_SECONDARY_ORDER);
    setPlannerNote(null);
    setErrors([]);
  }

  function draftOf(current: Form): ClaimDraft {
    return {
      statement: current.statement,
      x: current.x,
      y: current.y,
      covariate:
        current.covariateMode === 'asserted'
          ? { kind: 'asserted', column: current.z, confirmed: current.confirmed }
          : current.covariateMode === 'none'
            ? { kind: 'none' }
            : null,
      direction: current.direction,
      delta: current.deltaText.trim() === '' ? Number.NaN : Number(current.deltaText),
      xUnits: current.xUnits,
      yUnits: current.yUnits,
      iidAcknowledged: current.iid,
    };
  }

  function onPreview(event: FormEvent) {
    event.preventDefault();
    if (!source || !form) return;
    const built = buildProtocol({
      table: tableOf(source),
      dataset: datasetOf(source),
      claim: draftOf(form),
      seed: Number(form.seedText),
      permutations: Number(form.permutationsText),
      secondaryOrder,
      engineSourceDigest,
      parentAnalysisId: source.kind === 'revision' ? source.parent.id : null,
    });
    if (!built.ok) {
      setErrors(built.errors);
      setPreview(null);
      return;
    }
    setErrors([]);
    setPreview({ protocol: built.protocol, hash: built.hash, key: crypto.randomUUID() });
  }

  async function onFreeze() {
    if (!source || !preview) return;
    const base = {
      createdAt: new Date().toISOString(),
      datasetName: nameOf(source),
      table: tableOf(source),
      headerMap: headerMapOf(source),
      columns: columnsMetaOf(source),
      protocol: preview.protocol,
      protocolHash: preview.hash,
      originalExecutionId: null,
      executions: [],
      share: null,
      storedDerived: null,
      savedExecutionIds: [],
    };
    if (serverFreeze) {
      setFreezing(true);
      // The idempotency key is fixed per preview, so a retry cannot create a second analysis.
      const result = await freezeOnServer(base, preview.key);
      setFreezing(false);
      if (!result.ok) {
        setErrors([`The server did not record the protocol: ${result.error}. Nothing was run.`]);
        return;
      }
      putSession({
        ...base,
        id: result.value.analysisId,
        persistence: { kind: 'saved', origin: 'server_frozen', serverReceivedAt: result.value.serverReceivedAt },
        serverExecutionId: result.value.executionId,
      });
      window.location.hash = `#/analyses/${encodeURIComponent(result.value.analysisId)}`;
      return;
    }
    const id = crypto.randomUUID();
    putSession({ ...base, id, persistence: { kind: 'local' }, serverExecutionId: null });
    window.location.hash = `#/analyses/${encodeURIComponent(id)}`;
  }

  const update = (patch: Partial<Form>) => {
    if (!form) return;
    setForm({ ...form, ...patch });
    setPreview(null);
  };

  const columns = source ? tableOf(source).columns : [];
  const labelFor = (id: string) => {
    const meta = source ? columnsMetaOf(source) : null;
    if (meta) return meta.find((column) => column.id === id)?.label ?? id;
    const entry = source ? headerMapOf(source)?.find((item) => item.id === id) : undefined;
    return entry && entry.source !== id ? `${id} (“${entry.source}”)` : id;
  };

  return (
    <section>
      <h1>New analysis</h1>
      <p>
        Freeze the claim, a practical threshold δ and at most one asserted covariate before any result is computed.
        Rows stay in this browser unless you later save or share explicitly.
      </p>
      <div className="actions">
        <button type="button" onClick={() => loadFixture('confounded')}>Workshop demo (confounded)</button>
        <button type="button" className="secondary" onClick={() => loadFixture('real')}>Workshop demo (real effect)</button>
        <label className="button secondary">
          Upload a numeric CSV (≤ 1 MiB)
          <input
            className="file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {errors.length > 0 ? (
        <div className="error" role="alert">
          <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      ) : null}

      {source?.kind === 'revision' ? (
        <p className="note">
          Revising “{source.parent.protocol.claim.statement}”. The parent analysis and its evidence stay unchanged; this freezes a
          new protocol linked by parentAnalysisId. Changing settings after seeing results is exploration; the new record is labelled as a revision.
        </p>
      ) : null}

      {source?.kind === 'fixture' ? (
        <div className="note">
          <p><strong>{source.fixture.title}.</strong> {source.fixture.description}</p>
          <p className="muted">
            Generator {source.fixture.source.generatorVersion}, seed {source.fixture.source.seed}. The suggested settings
            below come from fixture metadata; review and accept them yourself. No result is shown until the engine runs.
          </p>
          <ul className="columns">
            {source.fixture.columns.map((column) => (
              <li key={column.id}><code>{column.id}</code> — {column.label} [{column.role.replaceAll('_', ' ')}]</li>
            ))}
          </ul>
        </div>
      ) : null}

      {source?.kind === 'csv' ? (
        <div className="note">
          <p>
            {source.parsed.table.rows.length} rows × {source.parsed.table.columns.length} columns. Original file hash{' '}
            <code>{shortHash(source.parsed.source.originalHash)}</code>.
          </p>
          <table className="compact">
            <thead><tr><th>Header in file</th><th>Identifier</th></tr></thead>
            <tbody>
              {source.parsed.headerMap.map((entry) => (
                <tr key={entry.id}><td>{entry.source}</td><td><code>{entry.id}</code></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {source && form ? (
        <form className="stack" onSubmit={onPreview}>
          <label>
            Claim (quoted as written; it is data, not an instruction)
            <textarea value={form.statement} maxLength={2000} onChange={(event) => update({ statement: event.target.value })} required />
          </label>
          <div className="form-grid">
            <label>
              Predictor x
              <select value={form.x} onChange={(event) => update({ x: event.target.value })}>
                {columns.map((column) => <option key={column} value={column}>{labelFor(column)}</option>)}
              </select>
            </label>
            <label>
              Outcome y
              <select value={form.y} onChange={(event) => update({ y: event.target.value })}>
                {columns.map((column) => <option key={column} value={column}>{labelFor(column)}</option>)}
              </select>
            </label>
            <label>
              Direction
              <select value={form.direction} onChange={(event) => update({ direction: event.target.value as Direction })}>
                <option value="positive">positive</option>
                <option value="negative">negative</option>
              </select>
            </label>
            <label>
              δ (smallest meaningful slope, &gt; 0)
              <input value={form.deltaText} inputMode="decimal" onChange={(event) => update({ deltaText: event.target.value })} required />
            </label>
            <label>
              Predictor units
              <input value={form.xUnits} maxLength={128} onChange={(event) => update({ xUnits: event.target.value })} required />
            </label>
            <label>
              Outcome units
              <input value={form.yUnits} maxLength={128} onChange={(event) => update({ yUnits: event.target.value })} required />
            </label>
          </div>
          <p className="muted">
            δ is in {form.yUnits || 'outcome units'} per {form.xUnits || 'predictor unit'}. Set it from domain knowledge before
            seeing results; it is never inferred from the data.
          </p>

          <fieldset>
            <legend>Primary adjustment (at most one covariate)</legend>
            <label>
              <input type="radio" name="covariate" checked={form.covariateMode === 'asserted'} onChange={() => update({ covariateMode: 'asserted', confirmed: false })} />
              Adjust for one observed covariate
            </label>
            {form.covariateMode === 'asserted' ? (
              <div className="stack indent">
                <select value={form.z} onChange={(event) => update({ z: event.target.value, confirmed: false })}>
                  <option value="">Choose a column</option>
                  {columns.filter((column) => column !== form.x && column !== form.y).map((column) => (
                    <option key={column} value={column}>{labelFor(column)}</option>
                  ))}
                </select>
                <label>
                  <input type="checkbox" checked={form.confirmed} onChange={(event) => update({ confirmed: event.target.checked })} />
                  I assert this column is a pre-exposure common cause of {form.x} and {form.y}. Its name and position do not establish that; the app does not check it.
                </label>
              </div>
            ) : null}
            <label>
              <input type="radio" name="covariate" checked={form.covariateMode === 'none'} onChange={() => update({ covariateMode: 'none', z: '', confirmed: false })} />
              No defensible covariate (the result will say confounding was not assessed)
            </label>
          </fieldset>

          <label>
            <input type="checkbox" checked={form.iid} onChange={(event) => update({ iid: event.target.checked })} />
            Rows are independent observations (no groups, clusters, repeats or time series). I acknowledge the app does not verify this.
          </label>

          <details>
            <summary>Seed and permutation budget</summary>
            <div className="form-grid">
              <label>
                Seed
                <input value={form.seedText} inputMode="numeric" onChange={(event) => update({ seedText: event.target.value })} />
              </label>
              <label>
                Permutations (max {MAX_PERMUTATIONS})
                <input value={form.permutationsText} inputMode="numeric" onChange={(event) => update({ permutationsText: event.target.value })} />
              </label>
            </div>
          </details>

          <PlannerPanel
            key={`${form.statement}|${form.x}|${form.y}|${form.direction}|${form.deltaText}|${form.xUnits}|${form.yUnits}`}
            columns={tableOf(source).columns}
            rowCount={tableOf(source).rows.length}
            headerMap={headerMapOf(source)}
            columnsMeta={columnsMetaOf(source)}
            claim={{ statement: form.statement, x: form.x, y: form.y, direction: form.direction, deltaText: form.deltaText, xUnits: form.xUnits, yUnits: form.yUnits }}
            onAccept={(proposal) => {
              setSecondaryOrder(proposal.secondaryOrder);
              setPlannerNote(proposal.note);
              update(proposal.covariate ? { covariateMode: 'asserted', z: proposal.covariate, confirmed: false } : { covariateMode: 'none', z: '', confirmed: false });
            }}
          />
          {plannerNote ? <p className="note">Model proposal text (not a result, not a fact): {plannerNote}</p> : null}

          <button type="submit">Preview the protocol</button>
        </form>
      ) : null}

      {preview ? (
        <section className="preview">
          <h2>Protocol preview</h2>
          <p>
            “{preview.protocol.claim.statement}” — {preview.protocol.claim.x} → {preview.protocol.claim.y}, {preview.protocol.claim.direction},
            δ = {formatNumber(preview.protocol.claim.delta)} {preview.protocol.claim.yUnits} per {preview.protocol.claim.xUnits}.
          </p>
          <ol>
            {executionOrder(preview.protocol).map((ordinal) => {
              const kind = preview.protocol.recipes[ordinal].kind;
              return (
                <li key={ordinal}>
                  <strong>{RECIPE_TITLES[kind]}</strong>
                  <p className="muted">{RECIPE_PROCEDURES[kind]}</p>
                </li>
              );
            })}
          </ol>
          <ul className="muted">
            <li>Assumptions: iid rows, classical homoskedastic normal-error OLS; the covariate role is your assertion.</li>
            <li>Seed {preview.protocol.seed}; {preview.protocol.permutations} permutations; {preview.protocol.attemptDeadlineMs / 1000} s per recipe.</li>
            <li>Policy {preview.protocol.policyId} v{preview.protocol.policyVersion}; engine {preview.protocol.engineVersion}; kernel digest <code>{shortHash(preview.protocol.engineSourceDigest)}</code>.</li>
            <li>Protocol hash <code>{shortHash(preview.hash)}</code>. Freezing records it before any numbers are computed.</li>
          </ul>
          <p className="muted">“Protocol frozen” means fixed in this record before execution here. It is not an independent preregistration and does not undo earlier exploration.</p>
          {auth.configured && auth.email ? (
            <label>
              <input type="checkbox" checked={serverFreeze} onChange={(event) => setServerFreeze(event.target.checked)} />
              Get a server receipt before running: upload these {preview.protocol.dataset.rowCount} rows and the protocol privately to my account now.
            </label>
          ) : null}
          <div className="actions">
            <button type="button" disabled={freezing} onClick={() => void onFreeze()}>{freezing ? 'Recording…' : serverFreeze ? 'Freeze with server receipt' : 'Freeze protocol'}</button>
            <button type="button" className="secondary" onClick={() => setPreview(null)}>Edit</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
