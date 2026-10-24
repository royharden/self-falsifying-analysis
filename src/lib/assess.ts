import { headlineFor } from './falsify/aggregate';
import type { ExecutionRecord } from './falsify/bundle';
import { canonicalHash } from './falsify/canonical';
import { FactBook, factsFor, validateExecution, type ReportFactV1 } from './falsify/grounding';
import { protocolHash, validateProtocol } from './falsify/planSchema';
import { normalizedTableHash, validateTable } from './falsify/table';
import type { Headline } from './falsify/types';
import { originalExecution, type AnalysisRecord } from './record';

export type Assessment = {
  execution: ExecutionRecord | null;
  integrityErrors: string[];
  facts: ReportFactV1[];
  book: FactBook;
  /** null until the original execution reaches a terminal status. */
  headline: Headline | null;
  factsHash: string | null;
};

/** Identity checks shared by every view of a record. */
export function identityErrors(record: AnalysisRecord): string[] {
  const errors: string[] = [];
  const checked = validateProtocol(record.protocol, record.table.columns);
  if (!checked.ok) return checked.errors;
  errors.push(...validateTable(record.table));
  if (errors.length > 0) return errors;
  if (protocolHash(record.protocol) !== record.protocolHash) errors.push('The protocol hash does not match the frozen protocol.');
  if (normalizedTableHash(record.table) !== record.protocol.dataset.normalizedHash) {
    errors.push('The table does not match the dataset hash bound in the protocol.');
  }
  return errors;
}

/**
 * Regenerates facts and the headline from validated evidence. Stored derived
 * values are never displayed; a mismatch with them is itself an integrity error.
 */
export function assess(record: AnalysisRecord, storedOverride: { headlineCode: string; factsHash: string } | null = null): Assessment {
  const stored = storedOverride ?? record.storedDerived;
  const execution = originalExecution(record);
  const integrityErrors = identityErrors(record);
  if (execution && integrityErrors.length === 0) {
    integrityErrors.push(...validateExecution(execution, record.protocol, record.protocolHash));
    if (execution.scope.kind !== 'full') integrityErrors.push('The original execution is not a full run.');
    if (execution.parentExecutionId !== null) integrityErrors.push('The original execution must not have a parent.');
    if (execution.analysisId !== record.id) integrityErrors.push('The original execution belongs to a different analysis.');
  }
  const facts = execution && integrityErrors.length === 0 ? factsFor(execution, record.protocol) : [];
  const factsHash = facts.length > 0 ? canonicalHash(facts) : null;
  let headline: Headline | null = null;
  if (execution && execution.status !== 'running') {
    headline = headlineFor(record.protocol, integrityErrors.length === 0 ? execution.attempts : [], integrityErrors);
  }
  if (stored && headline && integrityErrors.length === 0) {
    if (stored.headlineCode !== headline.code || stored.factsHash !== factsHash) {
      integrityErrors.push('Stored derived results disagree with results regenerated from the evidence.');
      headline = headlineFor(record.protocol, [], integrityErrors);
    }
  }
  return { execution, integrityErrors, facts, book: new FactBook(facts), headline, factsHash };
}
