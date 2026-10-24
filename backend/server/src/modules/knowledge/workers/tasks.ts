import { entityIdSchema, outboxEventSchema } from '@fob/shared/knowledge/contracts';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { Task, TaskList } from 'graphile-worker';
import { z } from 'zod';
import { outbox } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { consumerTask, DISPATCH_TASK, enqueueKnowledgeJob, jobKey } from './outbox';
import { observeWorker } from './logger';
import { KnowledgeJobError } from './types';
import type { KnowledgeConsumer, OutboxReference, OutboxTopic, WorkerObserver } from './types';

const referenceSchema = z.strictObject({ knowledgeBaseId: entityIdSchema, outboxId: entityIdSchema });
const topics = new Set<OutboxTopic>(['doc.changed', 'acl.changed', 'asset.created', 'knowledgeBase.event']);

function guarded(task: Task, observer?: WorkerObserver): Task {
  return async (payload, helpers) => {
    try { await task(payload, helpers); }
    catch (error) {
      const safe = error instanceof KnowledgeJobError ? error : new KnowledgeJobError(helpers.abortSignal.aborted ? 'job_aborted' : 'consumer_failed');
      observeWorker(observer, { type: 'job_failed', code: safe.code, jobId: helpers.job.id });
      throw safe;
    }
  };
}

function reference(input: unknown): OutboxReference {
  const value = referenceSchema.safeParse(input);
  if (!value.success) throw new KnowledgeJobError('invalid_job');
  return value.data;
}

export function createKnowledgeTaskList(pool: Pool, consumers: readonly KnowledgeConsumer[], observer?: WorkerObserver): TaskList {
  const routes = new Map<OutboxTopic, KnowledgeConsumer[]>();
  const names = new Set<string>();
  for (const consumer of consumers) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(consumer.name) || names.has(consumer.name) || !topics.has(consumer.topic) || typeof consumer.handle !== 'function') {
      throw new TypeError('Invalid or duplicate knowledge worker consumer');
    }
    names.add(consumer.name);
    routes.set(consumer.topic, [...(routes.get(consumer.topic) ?? []), { ...consumer }]);
  }
  const tasks: TaskList = Object.create(null);
  tasks[DISPATCH_TASK] = guarded(async (input, helpers) => {
    const key = reference(input);
    await withKnowledgeBase(pool, key.knowledgeBaseId, async (db) => {
      helpers.abortSignal.throwIfAborted();
      const [row] = await db.select().from(outbox)
        .where(and(eq(outbox.knowledgeBaseId, key.knowledgeBaseId), eq(outbox.id, key.outboxId))).for('update');
      if (!row) throw new KnowledgeJobError('event_missing');
      if (row.dispatchedAt) return;
      const event = outboxEventSchema.safeParse(row.payload);
      if (!event.success || event.data.knowledgeBaseId !== key.knowledgeBaseId || event.data.topic !== row.topic) throw new KnowledgeJobError('invalid_event');
      const handlers = routes.get(event.data.topic);
      if (!handlers?.length) throw new KnowledgeJobError('unhandled_topic');
      for (const handler of handlers) await enqueueKnowledgeJob(db, consumerTask(handler.name), key);
      helpers.abortSignal.throwIfAborted();
      await db.update(outbox).set({ dispatchedAt: new Date() }).where(and(eq(outbox.knowledgeBaseId, key.knowledgeBaseId), eq(outbox.id, key.outboxId)));
    });
  }, observer);
  for (const consumersForTopic of routes.values()) for (const consumer of consumersForTopic) {
    const task = consumerTask(consumer.name);
    tasks[task] = guarded(async (input, helpers) => {
      const key = reference(input);
      const event = await withKnowledgeBase(pool, key.knowledgeBaseId, async (db) => {
        const [row] = await db.select().from(outbox).where(and(eq(outbox.knowledgeBaseId, key.knowledgeBaseId), eq(outbox.id, key.outboxId)));
        // No long network/model work is allowed inside this short read transaction.
        if (!row) throw new KnowledgeJobError('event_missing');
        const parsed = outboxEventSchema.safeParse(row.payload);
        if (!row.dispatchedAt || !parsed.success || parsed.data.knowledgeBaseId !== key.knowledgeBaseId || parsed.data.topic !== consumer.topic) throw new KnowledgeJobError('invalid_event');
        return parsed.data;
      });
      helpers.abortSignal.throwIfAborted();
      await consumer.handle(event, {
        ...key, signal: helpers.abortSignal, attempt: helpers.job.attempts, idempotencyKey: jobKey(task, key),
      });
      helpers.abortSignal.throwIfAborted();
    }, observer);
  }
  return tasks;
}
