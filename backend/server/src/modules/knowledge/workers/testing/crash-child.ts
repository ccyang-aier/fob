import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { startKnowledgeWorker } from '../runner';

// Only the integration-test parent can pass a URL for its own disposable database.
const url = process.env.KNOWLEDGE_QUEUE_TEST_URL;
const id = process.env.KNOWLEDGE_QUEUE_TEST_OUTBOX;
if (!url || !/^\/fob_rls_[a-f0-9]{32}$/.test(new URL(url).pathname) || !id) throw new Error('A disposable queue test database is required');
const pool = new Pool({ connectionString: url, max: 4 });
pool.on('error', () => {});
await startKnowledgeWorker({ pool, pollIntervalMs: 25, consumers: [{
  name: 'crash_target', topic: 'doc.changed', handle: async (_event, context) => {
    if (context.outboxId !== id) throw new Error('Unexpected acceptance fixture');
    console.log('JOB_HELD');
    await delay(60_000, undefined, { signal: context.signal });
  },
}] });
