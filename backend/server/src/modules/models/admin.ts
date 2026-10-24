import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import { modelCatalogSchema } from '@fob/shared/model-catalog';
import type { ModelCatalog } from '@fob/shared/model-catalog';
import { FobDatabaseError } from '../../platform/database/initialize-config';
import type { FobSqlConnection } from '../../platform/database/initialize-role';
import { catalogModel } from './schema';

export function validateModelCatalog(value: unknown): ModelCatalog {
  const parsed = modelCatalogSchema.safeParse(value);
  if (!parsed.success) throw new FobDatabaseError('invalid_config', 'Model catalog data does not match the shared model metadata contract.');
  const ids = new Set<string>();
  for (const item of parsed.data.items) {
    if (ids.has(item.id)) throw new FobDatabaseError('invalid_config', 'Model catalog data contains duplicate model IDs.');
    ids.add(item.id);
  }
  return parsed.data;
}

export async function readBundledModelCatalog(): Promise<ModelCatalog> {
  const data = await readFile(new URL('./catalog-data.json', import.meta.url), 'utf8');
  try { return validateModelCatalog(JSON.parse(data)); }
  catch (error) {
    if (error instanceof FobDatabaseError) throw error;
    throw new FobDatabaseError('invalid_config', 'Model catalog data must be valid JSON.');
  }
}

export async function grantModelCatalogReadAccess(client: FobSqlConnection, applicationRole: string) {
  const role = `"${applicationRole.replaceAll('"', '""')}"`;
  await client.query(`REVOKE ALL ON SCHEMA catalog FROM PUBLIC, ${role}`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA catalog FROM PUBLIC, ${role}`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA catalog FROM PUBLIC, ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA catalog TO ${role}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA catalog TO ${role}`);
}

/** The caller owns the transaction; runtime credentials cannot perform this operation. */
export async function writeModelCatalog(client: PoolClient, catalog: ModelCatalog) {
  const db = drizzle(client);
  await db.delete(catalogModel);
  if (catalog.items.length) await db.insert(catalogModel).values(catalog.items);
}

/** Validate the whole payload before acquiring a connection or modifying rows. */
export async function importModelCatalog(admin: Pool, value: unknown): Promise<number> {
  const catalog = validateModelCatalog(value);
  const client = await admin.connect();
  let reusable = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:catalog:import'))");
    await writeModelCatalog(client, catalog);
    await client.query('COMMIT');
    reusable = true;
    return catalog.items.length;
  } catch (error) {
    try { await client.query('ROLLBACK'); reusable = true; } catch { reusable = false; }
    throw error;
  } finally { client.release(!reusable); }
}
