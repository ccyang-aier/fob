import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { group, member, knowledgeBase } from './schema';
import { withFobIdentity, withKnowledgeBase } from './transaction';
import { createResourceTestDatabase, seedResourceTestData } from './resource-test-database';
import { inspectFobDatabase } from '../initialize-status';
import { resourcePoliciesForTable } from './rls';
import type { ResourceTestDatabase } from './resource-test-database';

let database: ResourceTestDatabase;
let data: Awaited<ReturnType<typeof seedResourceTestData>>;
const sessionId = randomUUID();
const anotherKnowledgeBaseId = randomUUID();

function code(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'cause' in error ? code(error.cause) : undefined;
}

async function sqlFailure(operation: () => Promise<unknown>, expected: string) {
  let actual: string | undefined;
  try { await operation(); } catch (error) { actual = code(error); }
  expect(actual).toBe(expected);
}

beforeAll(async () => {
  database = await createResourceTestDatabase();
  data = await seedResourceTestData(database.admin);
  const [alpha, beta] = data.resources;
  await database.admin.query('UPDATE auth."user" SET email_verified = true WHERE id = $1', [alpha.userId]);
  await database.admin.query('INSERT INTO auth.session (id, user_id, token, expires_at) VALUES ($1, $2, $3, now() + interval \'1 hour\')', [sessionId, alpha.userId, randomUUID()]);
  await database.admin.query('INSERT INTO resources.knowledge_base (id, name) VALUES ($1, $2)', [anotherKnowledgeBaseId, 'Another own knowledgeBase']);
  await database.admin.query('INSERT INTO resources.knowledge_base_member (knowledge_base_id, user_id, role) VALUES ($1, $2, $3), ($4, $5, $6)', [anotherKnowledgeBaseId, alpha.userId, 'owner', alpha.knowledgeBaseId, beta.userId, 'guest']);
}, 30_000);

afterAll(async () => { if (database) await database.dispose(); }, 30_000);

describe('verified session identity discovery RLS', () => {
  test('deployment check detects a weakened identity discovery policy', async () => {
    await database.admin.query('ALTER POLICY own_identity ON resources.knowledge_base_member USING (true)');
    try {
      const status = await inspectFobDatabase(database.admin, database.pool);
      expect(status.state).toBe('incomplete');
      expect(status.issues).toContain('Resource policy differs from current definition: resources.knowledge_base_member');
    } finally {
      const policy = resourcePoliciesForTable(member).find((item) => item.name === 'own_identity')!;
      await database.admin.query(`ALTER POLICY own_identity ON resources.knowledge_base_member USING (${policy.using})`);
    }
    expect((await inspectFobDatabase(database.admin, database.pool)).state).toBe('ready');
  });

  test('can discover only own memberships/knowledgeBases, never another member or resource content', async () => {
    const own = await withFobIdentity(database.pool, sessionId, async (db) => ({
      knowledgeBases: await db.select().from(knowledgeBase), memberships: await db.select().from(member), groups: await db.select().from(group),
    }));
    expect(own.knowledgeBases.map((row) => row.id).sort()).toEqual([data.resources[0].knowledgeBaseId, anotherKnowledgeBaseId].sort());
    expect(own.memberships).toHaveLength(2);
    expect(own.memberships.every((row) => row.userId === data.resources[0].userId)).toBe(true);
    expect(own.groups).toHaveLength(0);
    expect((await database.pool.query('SELECT * FROM resources.knowledge_base')).rowCount).toBe(0);
  });

  test('identity transaction is genuinely read-only, not just a narrowed TypeScript surface', async () => {
    await sqlFailure(() => withFobIdentity(database.pool, sessionId, (db) => db.execute(sql`UPDATE ${knowledgeBase} SET name = 'forbidden'`)), '25006');
    await sqlFailure(() => withFobIdentity(database.pool, sessionId, (db) => db.execute(sql`DELETE FROM ${member}`)), '25006');
    await sqlFailure(() => withFobIdentity(database.pool, sessionId, (db) => db.execute(sql`INSERT INTO ${knowledgeBase} (id, name) VALUES (${randomUUID()}, 'forbidden')`)), '25006');
  });

  test('SELECT-only identity policies do not grant UPDATE, DELETE or INSERT even in a writable transaction', async () => {
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.auth_session_id', $1, true)", [sessionId]);
      expect((await client.query('SELECT * FROM resources.knowledge_base')).rowCount).toBe(2);
      expect((await client.query('UPDATE resources.knowledge_base SET name = name RETURNING *')).rowCount).toBe(0);
      expect((await client.query('DELETE FROM resources.knowledge_base_member RETURNING *')).rowCount).toBe(0);
      await sqlFailure(() => client.query('INSERT INTO resources.knowledge_base (id, name) VALUES ($1, $2)', [randomUUID(), 'No write scope']), '42501');
    } finally { await client.query('ROLLBACK'); client.release(); }
  });

  test('unknown, expired and unverified sessions fail closed', async () => {
    const discover = (id: string) => withFobIdentity(database.pool, id, (db) => db.select().from(knowledgeBase));
    expect(await discover(randomUUID())).toHaveLength(0);
    await database.admin.query('UPDATE auth.session SET expires_at = now() - interval \'1 second\' WHERE id = $1', [sessionId]);
    expect(await discover(sessionId)).toHaveLength(0);
    await database.admin.query('UPDATE auth.session SET expires_at = now() + interval \'1 hour\' WHERE id = $1', [sessionId]);
    await database.admin.query('UPDATE auth."user" SET email_verified = false WHERE id = $1', [data.resources[0].userId]);
    expect(await discover(sessionId)).toHaveLength(0);
    await database.admin.query('UPDATE auth."user" SET email_verified = true WHERE id = $1', [data.resources[0].userId]);
    expect(await discover(sessionId)).toHaveLength(2);
  });

  test('commit and rollback clear identity scope on the same reused physical connection', async () => {
    const readScope = () => database.pool.query<{ pid: number; identity: string | null; resource: string | null }>("SELECT pg_backend_pid() AS pid, NULLIF(current_setting('app.auth_session_id', true), '') AS identity, NULLIF(current_setting('app.knowledge_base_id', true), '') AS resource");
    const before = (await readScope()).rows[0]!;
    const pid = await withFobIdentity(database.pool, sessionId, async (db) => {
      const result = await db.execute<{ pid: number; id: string; resource: string }>(sql`SELECT pg_backend_pid() AS pid, current_setting('app.auth_session_id') AS id, current_setting('app.knowledge_base_id') AS resource`);
      expect(result.rows[0]!.id).toBe(sessionId);
      expect(result.rows[0]!.resource).toBe('');
      return result.rows[0]!.pid;
    });
    expect(pid).toBe(before.pid);
    expect((await readScope()).rows[0]).toEqual({ pid, identity: null, resource: null });
    await expect(withFobIdentity(database.pool, sessionId, async () => { throw new Error('rollback identity request'); })).rejects.toThrow('rollback identity request');
    expect((await readScope()).rows[0]).toEqual({ pid, identity: null, resource: null });
    await withKnowledgeBase(database.pool, data.resources[1].knowledgeBaseId, async (db) => {
      const rows = await db.select().from(knowledgeBase);
      expect(rows.map((row) => row.id)).toEqual([data.resources[1].knowledgeBaseId]);
      const identity = await db.execute<{ id: string }>(sql`SELECT current_setting('app.auth_session_id') AS id`);
      expect(identity.rows[0]!.id).toBe('');
    });
  });

  test('each scope actively clears a previous session-wide setting for the duration of its transaction', async () => {
    await database.pool.query("SELECT set_config('app.auth_session_id', $1, false)", [sessionId]);
    try {
      await withKnowledgeBase(database.pool, data.resources[1].knowledgeBaseId, async (db) => {
        expect((await db.select().from(knowledgeBase)).map((row) => row.id)).toEqual([data.resources[1].knowledgeBaseId]);
      });
    } finally { await database.pool.query('RESET app.auth_session_id'); }
    await database.pool.query("SELECT set_config('app.knowledge_base_id', $1, false)", [data.resources[1].knowledgeBaseId]);
    try {
      await withFobIdentity(database.pool, sessionId, async (db) => {
        expect((await db.select().from(knowledgeBase)).some((row) => row.id === data.resources[1].knowledgeBaseId)).toBe(false);
      });
    } finally { await database.pool.query('RESET app.knowledge_base_id'); }
  });

  test('session revocation immediately removes all discovery access', async () => {
    await database.admin.query('DELETE FROM auth.session WHERE id = $1', [sessionId]);
    expect(await withFobIdentity(database.pool, sessionId, (db) => db.select().from(knowledgeBase))).toHaveLength(0);
    expect(await withFobIdentity(database.pool, sessionId, (db) => db.select().from(member))).toHaveLength(0);
  });

  test('a session expiring inside an open read-only transaction is no longer discoverable', async () => {
    const shortSession = randomUUID();
    await database.admin.query("INSERT INTO auth.session (id, user_id, token, expires_at) VALUES ($1, $2, $3, clock_timestamp() + interval '300 milliseconds')", [shortSession, data.resources[0].userId, randomUUID()]);
    await withFobIdentity(database.pool, shortSession, async (db) => {
      expect(await db.select().from(knowledgeBase)).toHaveLength(2);
      await db.execute(sql`SELECT pg_sleep(0.35)`);
      expect(await db.select().from(knowledgeBase)).toHaveLength(0);
      expect(await db.select().from(member)).toHaveLength(0);
    });
  });
});
