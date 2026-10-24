import { randomUUID } from 'node:crypto';
import { test, expect } from 'bun:test';
import { readFobDatabaseConnections } from '../database/initialize-config';
import { createResourceTestDatabase, seedResourceTestData } from '../database/resources/resource-test-database';
import { withKnowledgeBase } from '../database/resources/transaction';
import { initializeKnowledgeJobs } from '../../modules/knowledge/workers/initialize';
import { appendKnowledgeOutbox } from '../../modules/knowledge/workers/outbox';
import { startFobKnowledgeWorker } from '../../entrypoints/worker';
import { readFobServiceConfig } from './config';
import { subscribeFobKnowledgeEvents, createFobKnowledgeEventPublisher } from './knowledge-events';

test('independent worker dispatches scoped invalidations to the Web service over Fob Redis', async () => {
  const database = await createResourceTestDatabase();
  let worker: Awaited<ReturnType<typeof startFobKnowledgeWorker>> | undefined;
  let subscription: Awaited<ReturnType<typeof subscribeFobKnowledgeEvents>> | undefined;
  let publisher: Awaited<ReturnType<typeof createFobKnowledgeEventPublisher>> | undefined;
  try {
    const fixture = await seedResourceTestData(database.admin);
    await initializeKnowledgeJobs(database.admin, database.pool);
    await database.admin.query('DELETE FROM resources.outbox');
    const connections = await readFobDatabaseConnections();
    const application = new URL(connections.application);
    application.pathname = `/${database.name}`;
    const config = readFobServiceConfig({ ...process.env, ROLE: 'worker', DATABASE_URL: application.toString() });
    const knowledgeBaseId = fixture.resources[0].knowledgeBaseId;
    const event = { type: 'page.updated' as const, id: randomUUID(), knowledgeBaseId, occurredAt: new Date().toISOString(), ids: [fixture.ids.page] };
    let receive: (value: unknown) => void = () => {};
    const delivered = new Promise(resolve => { receive = resolve; });
    subscription = await subscribeFobKnowledgeEvents(config.redisUrl!, value => {
      if (value.event.id === event.id) receive(value);
    });
    worker = await startFobKnowledgeWorker(config);
    expect(await worker.health()).toEqual({ status: 'ready' });
    await withKnowledgeBase(database.pool, knowledgeBaseId, db => appendKnowledgeOutbox(db, { knowledgeBaseId, topic: 'knowledgeBase.event', event }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scoped invalidation did not arrive')), 10_000); });
      expect(await Promise.race([delivered, timeout])).toEqual({ knowledgeBaseId, event });
    } finally { clearTimeout(timer); }
    publisher = await createFobKnowledgeEventPublisher(config.redisUrl!);
    await expect(publisher.publish({ knowledgeBaseId: randomUUID(), event })).rejects.toBeDefined();
  } finally {
    await worker?.close();
    await subscription?.close();
    await publisher?.close();
    await database.dispose();
  }
}, 30_000);
