import { randomUUID } from 'node:crypto';
import { entityIdSchema, outboxEventSchema } from '@fob/shared/knowledge/contracts';
import type { OutboxEvent } from '@fob/shared/knowledge/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { outbox } from '../../../platform/database/resources/schema';
import { KnowledgeJobError } from './types';
import type { OutboxReference } from './types';
import { recordSubscriptionChange } from '../subscriptions/service';

export const DISPATCH_TASK = 'resources.dispatch';
export const consumerTask = (name: string) => `resources.consume.${name}`;
export const jobKey = (task: string, reference: OutboxReference) => `${task}:${reference.knowledgeBaseId}:${reference.outboxId}`;

/** Must use the same transaction as the domain write and outbox insert. */
export async function enqueueKnowledgeJob(db: ResourceTransaction, task: string, reference: OutboxReference): Promise<string> {
  const result = await db.execute<{ id: string | null }>(sql`
    SELECT (knowledge_jobs.add_job(
      identifier => ${task}::text,
      payload => ${JSON.stringify(reference)}::json,
      max_attempts => 25,
      job_key => ${jobKey(task, reference)}::text,
      job_key_mode => 'preserve_run_at'
    )).id::text AS id
  `);
  // A concurrent add_job may return NULL. Never commit an outbox without its job.
  if (!result.rows[0]?.id) throw new KnowledgeJobError('enqueue_failed');
  return result.rows[0].id;
}

export async function appendKnowledgeOutbox(
  db: ResourceTransaction,
  input: OutboxEvent,
  id = randomUUID(),
): Promise<{ id: string; created: boolean }> {
  const parsed = outboxEventSchema.safeParse(input);
  if (!parsed.success || !entityIdSchema.safeParse(id).success) throw new KnowledgeJobError('invalid_event');
  const event = parsed.data;
  const inserted = await db.insert(outbox).values({ id, knowledgeBaseId: event.knowledgeBaseId, topic: event.topic, payload: event })
    .onConflictDoNothing().returning({ id: outbox.id });
  if (inserted.length) {
    await enqueueKnowledgeJob(db, DISPATCH_TASK, { knowledgeBaseId: event.knowledgeBaseId, outboxId: id });
    if (event.topic === 'doc.changed') for (const notice of await recordSubscriptionChange(db, { knowledgeBaseId: event.knowledgeBaseId, pageId: event.pageId, actorId: event.actor.userId, change: 'updated' })) await appendKnowledgeOutbox(db, notice);
    return { id, created: true };
  }
  const existing = await db.select({ matches: sql<boolean>`${outbox.payload} = ${JSON.stringify(event)}::jsonb` })
    .from(outbox).where(and(eq(outbox.knowledgeBaseId, event.knowledgeBaseId), eq(outbox.id, id)));
  if (existing[0]?.matches !== true) throw new KnowledgeJobError('event_conflict');
  // Completed Graphile jobs are deleted; the retained outbox is the durable dedup key.
  return { id, created: false };
}
