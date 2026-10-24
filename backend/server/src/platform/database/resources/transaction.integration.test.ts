import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { group, resourceTables, knowledgeBase, page, docState, modelCredential } from './schema';
import { ResourceTransactionAbortedError, readKnowledgeBaseResource, withKnowledgeBase } from './transaction';
import { createResourceTestDatabase, seedResourceTestData } from './resource-test-database';
import type { ResourceTestDatabase } from './resource-test-database';

let database: ResourceTestDatabase;
let data: Awaited<ReturnType<typeof seedResourceTestData>>;
const knowledgeTables = resourceTables.filter((table) => !['project', 'project_member'].includes(getTableConfig(table).name));
const scopeColumn = (table: typeof knowledgeBase | typeof resourceTables[number]) => sql.identifier(table === knowledgeBase ? 'id' : 'knowledge_base_id');

function postgresError(error: unknown): { code: string; message: string } | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string' && 'message' in error && typeof error.message === 'string') {
    return { code: error.code, message: error.message };
  }
  return 'cause' in error ? postgresError(error.cause) : undefined;
}

async function denied(operation: () => Promise<unknown>) {
  let failure: ReturnType<typeof postgresError>;
  try { await operation(); } catch (error) { failure = postgresError(error); }
  expect(failure?.code).toBe('42501');
  expect(failure?.message).toContain('row-level security');
}

beforeAll(async () => {
  database = await createResourceTestDatabase();
  data = await seedResourceTestData(database.admin);
}, 30_000);

afterAll(async () => {
  if (database) await database.dispose();
}, 30_000);

describe('real PostgreSQL resource isolation', () => {
  test('explicit cross-library reference reads cannot expose bodies/secrets or grant writes and always clear their scope', async () => {
    const [alpha, beta] = data.resources;
    await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, async db => {
      await readKnowledgeBaseResource(db, beta.knowledgeBaseId, async read => {
        expect((await read.select().from(page)).filter(row => row.knowledgeBaseId === beta.knowledgeBaseId).length).toBeGreaterThan(0);
        expect((await read.select().from(docState)).every(row => row.knowledgeBaseId === alpha.knowledgeBaseId)).toBe(true);
        expect((await read.select().from(modelCredential)).every(row => row.knowledgeBaseId === alpha.knowledgeBaseId)).toBe(true);
        const changed = await db.execute(sql`UPDATE resources.page SET title='Forbidden target write' WHERE knowledge_base_id=${beta.knowledgeBaseId} RETURNING id`);
        expect(changed.rowCount).toBe(0);
      });
      expect((await db.select().from(page)).every(row => row.knowledgeBaseId === alpha.knowledgeBaseId)).toBe(true);
      await expect(readKnowledgeBaseResource(db, beta.knowledgeBaseId, async () => { throw new Error('reference cancellation'); })).rejects.toThrow('reference cancellation');
      expect((await db.select().from(page)).every(row => row.knowledgeBaseId === alpha.knowledgeBaseId)).toBe(true);
      const setting = await db.execute<{ value: string }>(sql`SELECT current_setting('app.read_knowledge_base_id', true) AS value`);
      expect(setting.rows[0]?.value).toBe('');
    });
    expect((await database.pool.query("SELECT NULLIF(current_setting('app.read_knowledge_base_id', true), '') AS value")).rows[0]?.value).toBeNull();
  });
  test('runtime role cannot bypass RLS and every business table is ENABLE + FORCE protected', async () => {
    expect(database.role.rolsuper).toBe(false);
    expect(database.role.rolbypassrls).toBe(false);
    expect(database.role.rolcreatedb).toBe(false);
    expect(database.role.rolcreaterole).toBe(false);
    const actual = await database.admin.query<{ name: string; enabled: boolean; forced: boolean; expression: string; check: string; policies: number }>(`
      SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
        pg_get_expr(p.polqual, p.polrelid) AS expression, pg_get_expr(p.polwithcheck, p.polrelid) AS check,
        (SELECT count(*)::int FROM pg_policy p2 WHERE p2.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'knowledge_base_scope'
      WHERE n.nspname = 'resources' AND c.relkind = 'r'
    `);
    expect(actual.rowCount).toBe(knowledgeTables.length);
    for (const row of actual.rows) {
      expect(row.enabled, row.name).toBe(true);
      expect(row.forced, row.name).toBe(true);
      expect(row.expression, row.name).toContain('app.knowledge_base_id');
      expect(row.check, row.name).toBe(row.expression);
      const policyCounts: Record<string, number> = { knowledge_base: 2, knowledge_base_project: 2, knowledge_base_member: 3, page: 2, page_effective_acl: 2, group_member: 2, backlink: 2 };
      expect(row.policies, row.name).toBe(policyCounts[row.name] ?? 1);
    }
  });

  test('both resources see their own populated rows and no other resource rows in every business table', async () => {
    for (const resource of data.resources) {
      await withKnowledgeBase(database.pool, resource.knowledgeBaseId, async (db) => {
        for (const table of knowledgeTables) {
          const result = await db.execute<{ scope: string }>(sql`SELECT ${scopeColumn(table)}::text AS scope FROM ${table}`);
          expect(result.rows.length, getTableConfig(table).name).toBeGreaterThan(0);
          expect(result.rows.every((row) => row.scope === resource.knowledgeBaseId), getTableConfig(table).name).toBe(true);
        }
      });
    }
  });

  test('no-context reads fail closed for every business table and no-context writes are denied', async () => {
    for (const table of knowledgeTables) {
      const { schema, name } = getTableConfig(table);
      const result = await database.pool.query(`SELECT * FROM "${schema}"."${name}"`);
      expect(result.rowCount, name).toBe(0);
    }
    await denied(() => database.pool.query('INSERT INTO resources.knowledge_base (id, name) VALUES ($1, $2)', [randomUUID(), 'No context']));
  });

  test('FORCE RLS still filters an ordinary role that owns the table', async () => {
    const owner = await database.admin.query<{ role: string }>('SELECT current_user AS role');
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    await database.admin.query(`ALTER TABLE resources.knowledge_base OWNER TO ${quote(database.role.name)}`);
    try {
      expect((await database.pool.query('SELECT id FROM resources.knowledge_base')).rowCount).toBe(0);
      const own = await withKnowledgeBase(database.pool, data.resources[0].knowledgeBaseId, (db) => db.select().from(knowledgeBase));
      expect(own).toHaveLength(1);
      expect(own[0]?.id).toBe(data.resources[0].knowledgeBaseId);
    } finally {
      await database.admin.query(`ALTER TABLE resources.knowledge_base OWNER TO ${quote(owner.rows[0]!.role)}`);
      await database.admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON resources.knowledge_base TO ${quote(database.role.name)}`);
    }
  });

  test('cross-resource UPDATE and DELETE cannot target rows in any business table', async () => {
    const [alpha, beta] = data.resources;
    await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, async (db) => {
      for (const table of knowledgeTables) {
        const updated = await db.execute(sql`UPDATE ${table} SET ${scopeColumn(table)} = ${scopeColumn(table)} WHERE ${scopeColumn(table)} = ${beta.knowledgeBaseId} RETURNING ${scopeColumn(table)}`);
        const removed = await db.execute(sql`DELETE FROM ${table} WHERE ${scopeColumn(table)} = ${beta.knowledgeBaseId} RETURNING ${scopeColumn(table)}`);
        expect(updated.rowCount, getTableConfig(table).name).toBe(0);
        expect(removed.rowCount, getTableConfig(table).name).toBe(0);
      }
    });
  });

  test('WITH CHECK rejects inserting foreign-resource records in every business table', async () => {
    const [alpha, beta] = data.resources;
    for (const table of knowledgeTables) {
      const config = getTableConfig(table);
      const sample = await database.admin.query<{ record: Record<string, unknown> }>(
        `SELECT row_to_json(record) AS record FROM "${config.schema}"."${config.name}" AS record WHERE ${table === knowledgeBase ? 'id' : 'knowledge_base_id'} = $1 LIMIT 1`, [beta.knowledgeBaseId],
      );
      expect(sample.rowCount, config.name).toBe(1);
      const columns = sql.join(config.columns.filter((column) => !column.generatedIdentity && !column.generated).map((column) => sql.identifier(column.name)), sql`, `);
      await denied(() => withKnowledgeBase(database.pool, alpha.knowledgeBaseId, async (db) => {
        await db.execute(sql`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::${table}, ${JSON.stringify(sample.rows[0]!.record)}::jsonb)`);
      }));
    }
  }, 30_000);

  test('WITH CHECK also forbids changing a visible row to another knowledgeBase', async () => {
    const [alpha, beta] = data.resources;
    await denied(() => withKnowledgeBase(database.pool, alpha.knowledgeBaseId, async (db) => {
      await db.update(knowledgeBase).set({ id: beta.knowledgeBaseId });
    }));
  });

  test('a one-connection pool reuses the same connection after commit without leaking resource scope', async () => {
    const [alpha, beta] = data.resources;
    const first = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, async (db) => {
      const result = await db.execute<{ pid: number; scope: string }>(sql`SELECT pg_backend_pid() AS pid, current_setting('app.knowledge_base_id') AS scope`);
      expect(result.rows[0]?.scope).toBe(alpha.knowledgeBaseId);
      return result.rows[0]!.pid;
    });
    const cleared = await database.pool.query<{ pid: number; scope: string | null }>("SELECT pg_backend_pid() AS pid, NULLIF(current_setting('app.knowledge_base_id', true), '') AS scope");
    expect(cleared.rows[0]?.pid).toBe(first);
    expect(cleared.rows[0]?.scope).toBeNull();
    const second = await withKnowledgeBase(database.pool, beta.knowledgeBaseId, async (db) => {
      const result = await db.execute<{ pid: number; scope: string }>(sql`SELECT pg_backend_pid() AS pid, current_setting('app.knowledge_base_id') AS scope`);
      expect(result.rows[0]?.scope).toBe(beta.knowledgeBaseId);
      return result.rows[0]!.pid;
    });
    expect(second).toBe(first);
  });

  test('callback failure rolls back writes and clears scope while preserving a reusable connection', async () => {
    const [alpha] = data.resources;
    const before = await database.pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const id = randomUUID();
    const original = new Error('Abort this request');
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, async (db) => {
      await db.insert(group).values({ knowledgeBaseId: alpha.knowledgeBaseId, id, name: 'Must roll back' });
      throw original;
    })).rejects.toBe(original);
    const after = await database.pool.query<{ pid: number; scope: string | null }>("SELECT pg_backend_pid() AS pid, NULLIF(current_setting('app.knowledge_base_id', true), '') AS scope");
    expect(after.rows[0]?.pid).toBe(before.rows[0]?.pid);
    expect(after.rows[0]?.scope).toBeNull();
    const persisted = await database.admin.query('SELECT 1 FROM resources."group" WHERE knowledge_base_id = $1 AND id = $2', [alpha.knowledgeBaseId, id]);
    expect(persisted.rowCount).toBe(0);
  });

  test('a swallowed SQL error cannot be reported as a successful commit', async () => {
    const [alpha] = data.resources;
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, async (db) => {
      try { await db.execute(sql`SELECT 1 / 0`); } catch { /* Emulate a service accidentally swallowing a query failure. */ }
      return 'must not succeed';
    })).rejects.toBeInstanceOf(ResourceTransactionAbortedError);
    const scope = await database.pool.query<{ scope: string | null }>("SELECT NULLIF(current_setting('app.knowledge_base_id', true), '') AS scope");
    expect(scope.rows[0]?.scope).toBeNull();
  });

  test('a terminated borrowed connection is destroyed and the next request receives a clean replacement', async () => {
    const [alpha, beta] = data.resources;
    let terminatedPid = 0;
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, async (db) => {
      const current = await db.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      terminatedPid = current.rows[0]!.pid;
      await database.admin.query('SELECT pg_terminate_backend($1)', [terminatedPid]);
      await db.execute(sql`SELECT 1`);
    })).rejects.toBeDefined();
    const next = await withKnowledgeBase(database.pool, beta.knowledgeBaseId, async (db) => {
      const result = await db.execute<{ pid: number; scope: string }>(sql`SELECT pg_backend_pid() AS pid, current_setting('app.knowledge_base_id') AS scope`);
      return result.rows[0]!;
    });
    expect(next.pid).not.toBe(terminatedPid);
    expect(next.scope).toBe(beta.knowledgeBaseId);
    expect(database.idleErrors).toHaveLength(0);
  });
});
