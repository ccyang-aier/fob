import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { beforeAll, afterAll, afterEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { makeWorkerUtils } from 'graphile-worker';
import { Pool } from 'pg';
import type { OutboxEvent } from '@fob/shared/knowledge/contracts';
import { createResourceTestDatabase, seedResourceTestData } from '../../../platform/database/resources/resource-test-database';
import type { ResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { notification, page } from '../../../platform/database/resources/schema';
import type { RunningRole } from '../../../platform/runtime/lifecycle';
import { appendKnowledgeOutbox, consumerTask, DISPATCH_TASK, jobKey } from './outbox';
import { initializeKnowledgeJobs, KNOWLEDGE_JOBS_SCHEMA } from './initialize';
import { knowledgeWorkerLogger } from './logger';
import { startKnowledgeWorker } from './runner';
import { createKnowledgeTaskList } from './tasks';
import type { KnowledgeConsumer, KnowledgeWorkerDiagnostic } from './types';

let fixture: ResourceTestDatabase;
let pool: Pool;
let data: Awaited<ReturnType<typeof seedResourceTestData>>;
const runners = new Set<RunningRole>();

beforeAll(async () => {
  fixture = await createResourceTestDatabase();
  data = await seedResourceTestData(fixture.admin);
  pool = new Pool({ ...fixture.pool.options, max: 6 });
  pool.on('error', () => {});
  await initializeKnowledgeJobs(fixture.admin, pool);
  await fixture.admin.query('DELETE FROM resources.outbox');
}, 30_000);
afterEach(async () => {
  for (const runner of runners) await runner.close();
  runners.clear();
  await fixture.admin.query('DELETE FROM knowledge_jobs._private_jobs; DELETE FROM resources.outbox');
}, 15_000);
afterAll(async () => { await pool?.end(); await fixture?.dispose(); }, 30_000);

const sourceEvent = (resource: { knowledgeBaseId: string; userId: string } = data.resources[0]): OutboxEvent => ({
  knowledgeBaseId: resource.knowledgeBaseId, topic: 'doc.changed', pageId: data.ids.page,
  actor: { kind: 'human', userId: resource.userId }, occurredAt: new Date().toISOString(),
});
async function publish(event = sourceEvent(), id = randomUUID()) {
  return withKnowledgeBase(pool, event.knowledgeBaseId, (db) => appendKnowledgeOutbox(db, event, id));
}
async function until(check: () => Promise<boolean>, timeout = 10_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error('Queue acceptance condition timed out');
    await delay(25);
  }
}
async function start(consumers: KnowledgeConsumer[], diagnostics?: KnowledgeWorkerDiagnostic[]) {
  const runner = await startKnowledgeWorker({ pool, consumers, concurrency: 2, pollIntervalMs: 25,
    shutdownAbortAfterMs: 20, observer: (item) => diagnostics?.push(item) });
  runners.add(runner);
  return runner;
}
async function jobs() { return (await fixture.admin.query<{ id: string; task: string; payload: { knowledgeBaseId: string; outboxId: string }; attempts: number; locked_by: string | null; last_error: string | null }>(
  'SELECT j.id::text, t.identifier AS task, j.payload, j.attempts, j.locked_by, j.last_error FROM knowledge_jobs._private_jobs j JOIN knowledge_jobs._private_tasks t ON t.id=j.task_id',
)).rows; }

describe('transactional knowledge queue on real PostgreSQL', () => {
  test('bootstrap leaves runtime non-owner, no schema/DDL/TRUNCATE/migration writes', async () => {
    await expect(initializeKnowledgeJobs(fixture.admin, fixture.admin)).rejects.toMatchObject({ code: 'unsafe_role' });
    for (const query of ['CREATE TABLE knowledge_jobs.nope(id int)', 'TRUNCATE knowledge_jobs._private_jobs', 'DELETE FROM knowledge_jobs.migrations']) {
      await expect(pool.query(query)).rejects.toMatchObject({ code: '42501' });
    }
    const publicAccess = await fixture.admin.query<{ granted: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname='knowledge_jobs' AND a.grantee=0
    ) AS granted`);
    expect(publicAccess.rows[0].granted).toBe(false);
    await expect(startKnowledgeWorker({ pool: fixture.admin, consumers: [] })).rejects.toThrow('unprivileged');
  });

  test('domain write, outbox and scheduling roll back together and cross-resource writes fail', async () => {
    const event = sourceEvent();
    await expect(withKnowledgeBase(pool, event.knowledgeBaseId, async (db) => {
      await db.update(page).set({ title: 'must roll back' }).where(and(eq(page.knowledgeBaseId, event.knowledgeBaseId), eq(page.id, data.ids.page)));
      await appendKnowledgeOutbox(db, event);
      throw new Error('abort transaction');
    })).rejects.toThrow('abort transaction');
    expect(await jobs()).toEqual([]);
    expect((await fixture.admin.query('SELECT count(*)::int AS n FROM resources.outbox')).rows[0].n).toBe(0);
    expect((await fixture.admin.query('SELECT title FROM resources.page WHERE knowledge_base_id=$1 AND id=$2', [event.knowledgeBaseId, data.ids.page])).rows[0].title).not.toBe('must roll back');
    await expect(withKnowledgeBase(pool, event.knowledgeBaseId, (db) => appendKnowledgeOutbox(db, sourceEvent(data.resources[1])))).rejects.toBeDefined();
    expect(await jobs()).toEqual([]);
  });

  test('a scheduling failure also rolls back an already inserted outbox', async () => {
    const role = `"${fixture.role.name.replaceAll('"', '""')}"`;
    await fixture.admin.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA knowledge_jobs FROM ${role}`);
    try { await expect(publish()).rejects.toBeDefined(); }
    finally { await fixture.admin.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA knowledge_jobs TO ${role}`); }
    expect((await fixture.admin.query('SELECT count(*)::int AS n FROM resources.outbox')).rows[0].n).toBe(0);
    expect(await jobs()).toEqual([]);
  });

  test('concurrent same-ID insertion deduplicates permanently and rejects conflicting content', async () => {
    const event = sourceEvent();
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => publish(event, id)));
    expect(results.filter((item) => item.created)).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
    await expect(publish({ ...event, pageId: randomUUID() } as OutboxEvent, id)).rejects.toMatchObject({ code: 'event_conflict' });
    let delivered = 0;
    await start([{ name: 'dedup', topic: 'doc.changed', handle: async () => { delivered++; } }]);
    await until(async () => (await jobs()).length === 0);
    expect(delivered).toBe(1);
    expect(await publish(event, id)).toEqual({ id, created: false });
    expect(await jobs()).toEqual([]);
  });

  test('fixed consumers fan out by topic with knowledgeBase references, retry and idempotent domain effects', async () => {
    const diagnostics: KnowledgeWorkerDiagnostic[] = [];
    const attempts: number[] = [];
    const keys: string[] = [];
    const notificationId = randomUUID();
    let secondary = 0;
    const event = sourceEvent();
    const { id } = await publish(event);
    const rows = await jobs();
    expect(rows[0].payload).toEqual({ knowledgeBaseId: event.knowledgeBaseId, outboxId: id });
    await start([
      { name: 'retriable', topic: 'doc.changed', handle: async (received, context) => {
        expect(received).toEqual(event);
        attempts.push(context.attempt); keys.push(context.idempotencyKey);
        await withKnowledgeBase(pool, received.knowledgeBaseId, (db) => db.insert(notification).values({
          knowledgeBaseId: received.knowledgeBaseId, id: notificationId, userId: data.resources[0].userId, kind: 'queue-acceptance', payload: {},
        }).onConflictDoNothing().then(() => {}));
        if (context.attempt === 1) throw new Error('PRIVATE KEY OR PROVIDER BODY MUST NOT BE LOGGED');
      } },
      { name: 'secondary', topic: 'doc.changed', handle: async () => { secondary++; } },
    ], diagnostics);
    await until(async () => (await jobs()).some((job) => job.last_error !== null));
    expect((await jobs()).find((job) => job.last_error)?.last_error).toContain('consumer_failed');
    expect(JSON.stringify(await jobs()) + JSON.stringify(diagnostics)).not.toContain('PRIVATE KEY');
    await until(async () => (await jobs()).length === 0);
    expect(attempts).toEqual([1, 2]);
    expect(new Set(keys).size).toBe(1);
    expect(secondary).toBe(1);
    expect((await fixture.admin.query('SELECT count(*)::int AS n FROM resources.notification WHERE id=$1', [notificationId])).rows[0].n).toBe(1);
    expect((await fixture.admin.query('SELECT dispatched_at FROM resources.outbox WHERE id=$1', [id])).rows[0].dispatched_at).not.toBeNull();
  }, 15_000);

  test('missing routes remain recoverable and malformed/cross-resource references never invoke a handler', async () => {
    const event = sourceEvent();
    const { id } = await publish(event);
    const runner = await start([]);
    await until(async () => (await jobs()).some((job) => job.last_error !== null));
    expect((await jobs())[0].last_error).toContain('unhandled_topic');
    expect((await fixture.admin.query('SELECT dispatched_at FROM resources.outbox WHERE id=$1', [id])).rows[0].dispatched_at).toBeNull();
    await runner.close(); runners.delete(runner);
    const utils = await makeWorkerUtils({ pgPool: pool, schema: KNOWLEDGE_JOBS_SCHEMA, logger: knowledgeWorkerLogger() });
    try {
      await utils.addJob(DISPATCH_TASK, { knowledgeBaseId: data.resources[1].knowledgeBaseId, outboxId: id });
      await utils.addJob(DISPATCH_TASK, { knowledgeBaseId: event.knowledgeBaseId, outboxId: id, userId: data.resources[0].userId });
      const pending = await jobs();
      await utils.rescheduleJobs(pending.map((job) => job.id), { runAt: new Date(), attempts: 0 });
      let calls = 0;
      await start([{ name: 'later_route', topic: 'doc.changed', handle: async () => { calls++; } }]);
      await until(async () => (await jobs()).filter((job) => job.last_error).length === 2);
      expect(calls).toBe(1);
      expect((await jobs()).map((job) => job.last_error).join()).toContain('event_missing');
      expect((await jobs()).map((job) => job.last_error).join()).toContain('invalid_job');
    } finally { await utils.release(); }
  }, 15_000);

  test('fan-out scheduling failure rolls back every consumer job and the dispatched marker', async () => {
    const { id } = await publish();
    // Pinned-version fault injection only; production uses Graphile public APIs.
    await fixture.admin.query(`
      CREATE FUNCTION knowledge_jobs.acceptance_reject_second() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.task_id=(SELECT id FROM knowledge_jobs._private_tasks WHERE identifier='resources.consume.second') THEN
          RAISE EXCEPTION 'Injected scheduling failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER acceptance_reject_second BEFORE INSERT ON knowledge_jobs._private_jobs
        FOR EACH ROW EXECUTE FUNCTION knowledge_jobs.acceptance_reject_second();
    `);
    let delivered = 0;
    const consumers: KnowledgeConsumer[] = ['first', 'second'].map((name) => ({ name, topic: 'doc.changed', handle: async () => { delivered++; } }));
    const runner = await start(consumers);
    try {
      await until(async () => (await jobs()).some((job) => job.last_error));
      const pending = await jobs();
      expect(pending).toHaveLength(1);
      expect(pending[0].task).toBe(DISPATCH_TASK);
      expect(delivered).toBe(0);
      expect((await fixture.admin.query('SELECT dispatched_at FROM resources.outbox WHERE id=$1', [id])).rows[0].dispatched_at).toBeNull();
    } finally {
      await runner.close(); runners.delete(runner);
      await fixture.admin.query('DROP TRIGGER acceptance_reject_second ON knowledge_jobs._private_jobs; DROP FUNCTION knowledge_jobs.acceptance_reject_second()');
    }
    const utils = await makeWorkerUtils({ pgPool: pool, schema: KNOWLEDGE_JOBS_SCHEMA, logger: knowledgeWorkerLogger() });
    try { await utils.rescheduleJobs((await jobs()).map((job) => job.id), { runAt: new Date(), attempts: 0 }); }
    finally { await utils.release(); }
    await start(consumers);
    await until(async () => (await jobs()).length === 0);
    expect(delivered).toBe(2);
  }, 15_000);

  test('exhausted failures are retained for explicit retry, not silently deleted', async () => {
    await publish();
    const utils = await makeWorkerUtils({ pgPool: pool, schema: KNOWLEDGE_JOBS_SCHEMA, logger: knowledgeWorkerLogger() });
    try {
      await utils.rescheduleJobs((await jobs()).map((job) => job.id), { maxAttempts: 1 });
      const runner = await start([]);
      await until(async () => (await jobs()).some((job) => job.last_error));
      await runner.close(); runners.delete(runner);
      expect((await jobs())[0].attempts).toBe(1);
      expect((await fixture.admin.query('SELECT count(*)::int AS n FROM resources.outbox')).rows[0].n).toBe(1);
      await utils.rescheduleJobs((await jobs()).map((job) => job.id), { maxAttempts: 25, attempts: 0, runAt: new Date() });
      let delivered = 0;
      await start([{ name: 'after_retry', topic: 'doc.changed', handle: async () => { delivered++; } }]);
      await until(async () => (await jobs()).length === 0);
      expect(delivered).toBe(1);
    } finally { await utils.release(); }
  });

  test('clean shutdown aborts cooperative tasks, releases locks and is idempotent', async () => {
    await publish();
    const baseline = ['error', 'connect', 'acquire', 'remove'].map((event) => pool.listenerCount(event));
    let started = false, aborted = false;
    const runner = await start([{ name: 'cooperative', topic: 'doc.changed', handle: async (_event, context) => {
      started = true;
      try { await delay(60_000, undefined, { signal: context.signal }); }
      catch { aborted = context.signal.aborted; throw new Error('aborted'); }
    } }]);
    await until(async () => started);
    expect((await runner.health()).status).toBe('ready');
    await Promise.all([runner.close(), runner.close()]);
    runners.delete(runner);
    expect(aborted).toBe(true);
    expect((await runner.health()).status).toBe('degraded');
    expect((await jobs()).every((job) => job.locked_by === null)).toBe(true);
    expect(['error', 'connect', 'acquire', 'remove'].map((event) => pool.listenerCount(event))).toEqual(baseline);
  }, 15_000);

  test('an actually terminated worker leaves durable work recoverable after confirmed-dead unlock', async () => {
    const event = sourceEvent();
    const { id } = await publish(event);
    const dispatcher = await start([{ name: 'crash_target', topic: 'doc.changed', handle: async () => { throw new Error('hold for crash child'); } }]);
    await until(async () => (await jobs()).some((job) => job.task === consumerTask('crash_target') && job.last_error));
    await dispatcher.close(); runners.delete(dispatcher);
    await fixture.admin.query('UPDATE knowledge_jobs._private_jobs SET attempts=0, run_at=now(), last_error=NULL');
    const child = spawn(process.execPath, [fileURLToPath(new URL('./testing/crash-child.ts', import.meta.url))], {
      env: { ...process.env, KNOWLEDGE_QUEUE_TEST_URL: pool.options.connectionString, KNOWLEDGE_QUEUE_TEST_OUTBOX: id },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.stderr.resume();
    const exited = once(child, 'close');
    let lockedBy: string | null = null;
    try {
      await until(async () => output.includes('JOB_HELD'));
      lockedBy = (await jobs()).find((job) => job.payload.outboxId === id)?.locked_by ?? null;
      expect(lockedBy).not.toBeNull();
    } finally { child.kill('SIGKILL'); await exited; }
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect((await jobs())[0].locked_by).toBe(lockedBy);
    const utils = await makeWorkerUtils({ pgPool: pool, schema: KNOWLEDGE_JOBS_SCHEMA, logger: knowledgeWorkerLogger() });
    try { await utils.forceUnlockWorkers([lockedBy!]); }
    finally { await utils.release(); }
    let recovered = 0;
    await start([{ name: 'crash_target', topic: 'doc.changed', handle: async (_event, context) => {
      expect(context.idempotencyKey).toBe(jobKey(consumerTask('crash_target'), { knowledgeBaseId: event.knowledgeBaseId, outboxId: id }));
      recovered++;
    } }]);
    await until(async () => (await jobs()).length === 0);
    expect(recovered).toBe(1);
  }, 25_000);

  test('consumer configuration is fixed code and rejects executable paths and collisions', () => {
    const handle = async () => {};
    expect(() => createKnowledgeTaskList(pool, [{ name: '../execute', topic: 'doc.changed', handle }])).toThrow();
    expect(() => createKnowledgeTaskList(pool, [{ name: 'same', topic: 'doc.changed', handle }, { name: 'same', topic: 'asset.created', handle }])).toThrow();
  });
});
