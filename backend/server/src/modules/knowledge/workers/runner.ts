import { run } from 'graphile-worker';
import type { Pool } from 'pg';
import type { RunningRole } from '../../../platform/runtime/lifecycle';
import { isFobApplicationRoleSafe, readFobApplicationRole } from '../../../platform/database/initialize-role';
import { KNOWLEDGE_JOBS_SCHEMA } from './initialize';
import { knowledgeWorkerLogger, observeWorker } from './logger';
import { createKnowledgeTaskList } from './tasks';
import { guardKnowledgeWorkerPool } from './pool-errors';
import type { KnowledgeConsumer, WorkerObserver } from './types';

export interface KnowledgeWorkerOptions {
  pool: Pool;
  consumers: readonly KnowledgeConsumer[];
  concurrency?: number;
  pollIntervalMs?: number;
  shutdownAbortAfterMs?: number;
  observer?: WorkerObserver;
}

/** The caller owns the PostgreSQL pool and must close the runner before the pool. */
export async function startKnowledgeWorker(options: KnowledgeWorkerOptions): Promise<RunningRole> {
  const { pool, observer } = options;
  const concurrency = options.concurrency ?? 4;
  const pollInterval = options.pollIntervalMs ?? 1_000;
  const gracefulShutdownAbortTimeout = options.shutdownAbortAfterMs ?? 5_000;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32
    || !Number.isInteger(pollInterval) || pollInterval < 10 || pollInterval > 60_000
    || !Number.isInteger(gracefulShutdownAbortTimeout) || gracefulShutdownAbortTimeout < 1 || gracefulShutdownAbortTimeout > 30_000) {
    throw new TypeError('Invalid knowledge worker runtime options');
  }
  if (!isFobApplicationRoleSafe(await readFobApplicationRole(pool))) throw new Error('Knowledge workers require an unprivileged application database role');
  const taskList = createKnowledgeTaskList(pool, options.consumers, observer);
  const releaseErrors = guardKnowledgeWorkerPool(pool, observer);
  const runner = await run({
    pgPool: pool, schema: KNOWLEDGE_JOBS_SCHEMA,
    taskList,
    parsedCronItems: [], noHandleSignals: true, concurrency, pollInterval, gracefulShutdownAbortTimeout,
    // v0.18's non-batched completion/failure calls are fire-and-forget. The
    // zero-delay batchers have an awaited drain on shutdown; no locks are left.
    preset: { worker: { completeJobBatchDelay: 0, failJobBatchDelay: 0 } },
    logger: knowledgeWorkerLogger(observer),
  }).catch((error: unknown) => { releaseErrors(); throw error; });
  let stopped = false;
  let closing: Promise<void> | undefined;
  // Observe immediately: callers must not have to attach handlers to avoid a rejection.
  const done = runner.promise.then(() => { stopped = true; }, () => { stopped = true; }).finally(releaseErrors);
  return {
    close() {
      return closing ??= (async () => {
        if (!stopped) await runner.stop();
        await done;
        observeWorker(observer, { type: 'worker_stopped' });
      })();
    },
    async health() {
      if (closing || stopped) return { status: 'degraded', detail: 'Knowledge worker is stopped' };
      await pool.query('SELECT 1');
      return { status: 'ready' };
    },
  };
}
