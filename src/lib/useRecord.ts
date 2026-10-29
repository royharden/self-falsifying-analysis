import { useEffect, useState } from 'react';
import type { AnalysisRecord } from './record';
import { getSession, subscribeSession } from './session';

/** The current session copy of a record, re-rendering on every session change. */
export function useSessionRecord(id: string): AnalysisRecord | undefined {
  const [record, setRecord] = useState<AnalysisRecord | undefined>(() => getSession(id));
  useEffect(() => {
    setRecord(getSession(id));
    return subscribeSession(() => setRecord(getSession(id)));
  }, [id]);
  return record;
}

export function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
