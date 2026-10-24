import type { Pool, PoolClient } from 'pg';
import { observeWorker } from './logger';
import type { WorkerObserver } from './types';

/** Graphile requires both idle and checked-out connection error handlers. */
export function guardKnowledgeWorkerPool(pool: Pool, observer?: WorkerObserver): () => void {
  const clients = new Set<PoolClient>();
  const onError = () => observeWorker(observer, { type: 'worker_log', level: 'error' });
  const attach = (client: PoolClient) => {
    if (!clients.has(client)) { clients.add(client); client.on('error', onError); }
  };
  const detach = (client: PoolClient) => { clients.delete(client); client.off('error', onError); };
  pool.on('error', onError);
  pool.on('connect', attach);
  pool.on('acquire', attach); // Also covers sockets already created by the caller.
  pool.on('remove', detach);
  return () => {
    pool.off('error', onError); pool.off('connect', attach); pool.off('acquire', attach); pool.off('remove', detach);
    for (const client of clients) client.off('error', onError);
    clients.clear();
  };
}
