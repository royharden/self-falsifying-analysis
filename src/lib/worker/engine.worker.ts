/**
 * Engine worker. Validates the frozen protocol and the exact table once, then runs
 * one recipe per request. It never evaluates code from a bundle or share.
 */
import { runRecipe } from '../falsify/attacks';
import { protocolHash, validateProtocol } from '../falsify/planSchema';
import { normalizedTableHash, validateTable } from '../falsify/table';
import type { ProtocolV1, Table } from '../falsify/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

type WorkerScope = {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const scope = self as unknown as WorkerScope;

let loaded: { table: Table; protocol: ProtocolV1 } | null = null;

function reply(message: WorkerResponse): void {
  scope.postMessage(message);
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'load') {
    loaded = null;
    const errors: string[] = [];
    const checked = validateProtocol(message.protocol, Array.isArray(message.table?.columns) ? message.table.columns : null);
    if (!checked.ok) errors.push(...checked.errors);
    errors.push(...validateTable(message.table));
    if (errors.length === 0) {
      if (protocolHash(message.protocol) !== message.protocolHash) errors.push('Protocol hash does not match the frozen protocol.');
      if (normalizedTableHash(message.table) !== message.protocol.dataset.normalizedHash) {
        errors.push('Table hash does not match the dataset identity in the protocol.');
      }
    }
    if (errors.length > 0) {
      reply({ type: 'loaded', ok: false, errors });
      return;
    }
    loaded = { table: message.table, protocol: message.protocol };
    reply({ type: 'loaded', ok: true });
    return;
  }
  if (message.type === 'run') {
    if (!loaded) {
      reply({ type: 'failed', requestId: message.requestId, ordinal: message.ordinal, reason: 'The worker has no validated protocol.' });
      return;
    }
    if (!Number.isInteger(message.ordinal) || message.ordinal < 0 || message.ordinal >= loaded.protocol.recipes.length) {
      reply({ type: 'failed', requestId: message.requestId, ordinal: message.ordinal, reason: 'Unknown recipe ordinal.' });
      return;
    }
    reply({ type: 'started', requestId: message.requestId, ordinal: message.ordinal });
    try {
      const attempt = runRecipe(loaded.table, loaded.protocol, message.ordinal);
      reply({ type: 'result', requestId: message.requestId, attempt });
    } catch (error) {
      reply({
        type: 'failed',
        requestId: message.requestId,
        ordinal: message.ordinal,
        reason: error instanceof Error ? error.message.slice(0, 300) : 'Unexpected worker failure.',
      });
    }
  }
};
