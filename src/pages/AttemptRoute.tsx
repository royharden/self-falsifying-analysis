import { AttemptPage } from './AttemptPage';
import { useSessionRecord } from '../lib/useRecord';
import { useRemoteRecord } from '../lib/useRemoteRecord';

export function AttemptRoute({ id, ordinal }: { id: string; ordinal: number }) {
  const record = useSessionRecord(id);
  const remote = useRemoteRecord(id, record === undefined);
  const backHref = `#/analyses/${encodeURIComponent(id)}`;
  if (!record) {
    return (
      <section>
        <p><a href={backHref}>Back to the analysis</a></p>
        {remote.error ? <p className="error" role="alert">{remote.error}</p> : <p>{remote.loading ? 'Loading…' : 'This analysis is not in this browser tab.'}</p>}
      </section>
    );
  }
  return <AttemptPage record={record} ordinal={ordinal} backHref={backHref} />;
}
