import type { OutboxEvent } from '@fob/shared/knowledge/contracts';

export interface OutboxReference { knowledgeBaseId: string; outboxId: string }
export type OutboxTopic = OutboxEvent['topic'];
export interface KnowledgeJobContext extends OutboxReference {
  /** Stable across retries: use this key when an external service supports idempotency. */
  idempotencyKey: string;
  signal: AbortSignal;
  attempt: number;
}

/** Handlers are server-registered code, never a module path supplied in an event. */
export interface KnowledgeConsumer<T extends OutboxTopic = OutboxTopic> {
  name: string;
  topic: T;
  handle(event: Extract<OutboxEvent, { topic: T }>, context: KnowledgeJobContext): Promise<void>;
}

export type KnowledgeJobErrorCode =
  | 'invalid_event' | 'event_conflict' | 'enqueue_failed' | 'invalid_job'
  | 'event_missing' | 'unhandled_topic' | 'consumer_failed' | 'job_aborted';

/** Graphile persists an error's message. Do not attach raw SQL, payloads or causes. */
export class KnowledgeJobError extends Error {
  constructor(readonly code: KnowledgeJobErrorCode) {
    super(`Knowledge job failed: ${code}`);
    this.name = 'KnowledgeJobError';
  }
}

export type KnowledgeWorkerDiagnostic =
  | { type: 'job_failed'; code: KnowledgeJobErrorCode; jobId: string }
  | { type: 'worker_log'; level: string; jobId?: string }
  | { type: 'worker_stopped' };

export type WorkerObserver = (diagnostic: KnowledgeWorkerDiagnostic) => void;
