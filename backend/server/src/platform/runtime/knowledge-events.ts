import Redis from 'ioredis';
import { z } from 'zod';
import { entityIdSchema, knowledgeBaseEventSchema } from '@fob/shared/knowledge/contracts';

const channel = 'fob:knowledge-base:events';
const envelope = z.strictObject({ knowledgeBaseId: entityIdSchema, event: knowledgeBaseEventSchema })
  .refine(value => value.knowledgeBaseId === value.event.knowledgeBaseId);
type Envelope = z.infer<typeof envelope>;

/** Separate worker/API processes relay invalidation events through Fob's own Redis. */
export async function subscribeFobKnowledgeEvents(redisUrl: string, publish: (event: Envelope) => void) {
  const connection = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  connection.on('error', () => {});
  connection.on('message', (receivedChannel, message) => {
    if (receivedChannel !== channel) return;
    try {
      const parsed = envelope.safeParse(JSON.parse(message));
      if (parsed.success) publish(parsed.data);
    } catch { /* Invalid external pub/sub payloads never reach client sockets. */ }
  });
  try {
    await connection.connect();
    await connection.subscribe(channel);
  } catch (error) { connection.disconnect(); throw error; }
  return { async close() { await connection.quit(); } };
}

export async function createFobKnowledgeEventPublisher(redisUrl: string) {
  const connection = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  connection.on('error', () => {});
  try { await connection.connect(); }
  catch (error) { connection.disconnect(); throw error; }
  return {
    async publish(value: Envelope) { await connection.publish(channel, JSON.stringify(envelope.parse(value))); },
    async close() { await connection.quit(); },
  };
}
