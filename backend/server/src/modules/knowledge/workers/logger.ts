import { Logger } from 'graphile-worker';
import type { WorkerObserver } from './types';

/** Observability must not change queue semantics or persist arbitrary handler errors. */
export function observeWorker(observer: WorkerObserver | undefined, diagnostic: Parameters<WorkerObserver>[0]): void {
  try { observer?.(diagnostic); } catch { /* The worker remains authoritative. */ }
}

export function knowledgeWorkerLogger(observer?: WorkerObserver): Logger {
  return new Logger((scope) => (level) => {
    if (level !== 'error' && level !== 'warning') return;
    observeWorker(observer, {
      type: 'worker_log', level,
      ...(scope.jobId && /^\d+$/.test(scope.jobId) ? { jobId: scope.jobId } : {}),
    });
  });
}
