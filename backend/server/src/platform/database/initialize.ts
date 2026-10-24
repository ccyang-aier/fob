import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { FobDatabaseError } from './initialize-config';
import { assertFobApplicationRole } from './initialize-role';
import { inspectFobDatabase, fobDatabaseSchemas } from './initialize-status';
import { installResourceRls } from './resources/rls';
import { grantModelCatalogReadAccess, readBundledModelCatalog, writeModelCatalog } from '../../modules/models/admin';

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Create the current schema once. Existing schemas are never modified or reset. */
export async function initializeFobDatabase(admin: Pool, application: Pool): Promise<void> {
  const role = await assertFobApplicationRole(admin, application);
  const currentSql = await readFile(new URL('./current.sql', import.meta.url), 'utf8');
  const catalog = await readBundledModelCatalog();
  const client = await admin.connect();
  let reusable = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    const existing = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = ANY($1::text[])', [[...fobDatabaseSchemas]]);
    if (existing.rowCount) throw new FobDatabaseError('already_initialized', 'Fob schemas already exist. Use status or check; init never changes existing schemas.');
    await client.query(currentSql);
    await installResourceRls(client);
    const applicationRole = identifier(role.name);
    await client.query(`REVOKE ALL ON SCHEMA resources, auth FROM PUBLIC, ${applicationRole}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA resources, auth FROM PUBLIC, ${applicationRole}`);
    await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA resources, auth FROM PUBLIC, ${applicationRole}`);
    await client.query(`GRANT USAGE ON SCHEMA resources, auth, paradedb, pdb TO ${applicationRole}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA resources, auth TO ${applicationRole}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA resources, auth TO ${applicationRole}`);
    await grantModelCatalogReadAccess(client, role.name);
    await writeModelCatalog(client, catalog);
    const verified = await inspectFobDatabase(client, application);
    if (verified.state !== 'ready') throw new FobDatabaseError('check_failed', `Knowledge initialization checks failed: ${verified.issues.join('; ')}`);
    await client.query('COMMIT');
    reusable = true;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
      reusable = true;
    } catch { reusable = false; }
    throw error;
  } finally {
    client.release(!reusable);
  }
}
