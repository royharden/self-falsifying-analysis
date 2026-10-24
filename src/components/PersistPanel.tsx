import type { Assessment } from '../lib/assess';
import type { AnalysisRecord } from '../lib/record';

/** Save/share controls. Local mode only explains where the record lives. */
export function PersistPanel({ record }: { record: AnalysisRecord; assessment: Assessment }) {
  if (record.persistence.kind === 'shared_view') {
    return <p className="muted">Shared read-only snapshot. Reruns happen in your browser and are not written anywhere.</p>;
  }
  return <p className="muted">This analysis lives only in this browser tab. Export run.json to keep it; a reload loses it.</p>;
}
