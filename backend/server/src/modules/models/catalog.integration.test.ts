import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createResourceTestDatabase } from '../../platform/database/resources/resource-test-database';
import type { ResourceTestDatabase } from '../../platform/database/resources/resource-test-database';
import { inspectFobDatabase } from '../../platform/database/initialize-status';
import { initializeModelCatalog } from '../../../scripts/models-catalog';
import { importModelCatalog, readBundledModelCatalog } from './admin';
import { createModelCatalogRepository } from './repository';

let database: ResourceTestDatabase;
beforeAll(async () => { database = await createResourceTestDatabase(); }, 30_000);
afterAll(async () => { if (database) await database.dispose(); }, 30_000);

describe('PostgreSQL model catalog ownership and atomic administration', () => {
  test('runtime reads public reference rows and cannot insert, update, delete, truncate, or alter the table', async () => {
    const catalog = await createModelCatalogRepository(database.pool).list();
    expect(catalog.items).toHaveLength((await readBundledModelCatalog()).items.length);
    for (const query of [
      "INSERT INTO catalog.model SELECT * FROM catalog.model LIMIT 1",
      "UPDATE catalog.model SET name = 'Unauthorized'",
      'DELETE FROM catalog.model', 'TRUNCATE catalog.model',
      'ALTER TABLE catalog.model ADD COLUMN forbidden text',
      'CREATE TABLE catalog.forbidden (id int)',
    ]) await expect(database.pool.query(query)).rejects.toMatchObject({ code: '42501' });
    expect((await inspectFobDatabase(database.admin, database.pool)).state).toBe('ready');
  });

  test('read-only database inspection detects accidental catalog write grants', async () => {
    const client = await database.admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(`GRANT UPDATE ON catalog.model TO "${database.role.name.replaceAll('"', '""')}"`);
      const status = await inspectFobDatabase(client, database.pool);
      expect(status.state).toBe('incomplete');
      expect(status.issues).toContain('Application table grants differ from least privilege');
    } finally { await client.query('ROLLBACK'); client.release(); }
  });

  test('administrator replacement is atomic when a database write fails', async () => {
    const before = await createModelCatalogRepository(database.pool).list();
    await database.admin.query(`
      CREATE FUNCTION catalog.reject_test_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected catalog write failure' USING ERRCODE = 'P0001'; END $$;
      CREATE TRIGGER reject_test_write BEFORE INSERT ON catalog.model FOR EACH ROW EXECUTE FUNCTION catalog.reject_test_write();
    `);
    try { await expect(importModelCatalog(database.admin, before)).rejects.toBeDefined(); }
    finally { await database.admin.query('DROP TRIGGER reject_test_write ON catalog.model; DROP FUNCTION catalog.reject_test_write();'); }
    expect(await createModelCatalogRepository(database.pool).list()).toEqual(before);
    expect(await importModelCatalog(database.admin, before)).toBe(before.items.length);
    await expect(initializeModelCatalog(database.admin, database.pool)).rejects.toMatchObject({ code: 'already_initialized' });
  });

  test('standalone catalog initialization preserves independently owned application schemas', async () => {
    const empty = await createResourceTestDatabase({ initialize: false });
    try {
      await empty.admin.query('CREATE SCHEMA resources; CREATE TABLE resources.preserved (value int); INSERT INTO resources.preserved VALUES (42)');
      expect(await initializeModelCatalog(empty.admin, empty.pool)).toBe((await readBundledModelCatalog()).items.length);
      expect((await empty.admin.query('SELECT value FROM resources.preserved')).rows).toEqual([{ value: 42 }]);
      expect((await createModelCatalogRepository(empty.pool).list()).items.length).toBeGreaterThan(0);
    } finally { await empty.dispose(); }
  }, 30_000);
});
