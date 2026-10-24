import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { FobDatabaseError, fobDatabaseErrorMessage, readFobDatabaseConnections } from '../src/platform/database/initialize-config';
import { assertFobApplicationRole } from '../src/platform/database/initialize-role';
import { grantModelCatalogReadAccess, importModelCatalog, readBundledModelCatalog, validateModelCatalog, writeModelCatalog } from '../src/modules/models/admin';
import { modelCatalogDatabaseSchema } from '../src/modules/models/schema';

/** Initialize only an absent public catalog; existing application data is untouched. */
export async function initializeModelCatalog(admin: Pool, application: Pool) {
  const role = await assertFobApplicationRole(admin, application);
  const catalog = await readBundledModelCatalog();
  const ddl = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(modelCatalogDatabaseSchema, undefined, ['catalog']));
  const client = await admin.connect();
  let reusable = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    const existing = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'catalog'");
    if (existing.rowCount) throw new FobDatabaseError('already_initialized', 'The model catalog schema already exists. Use import to replace its reference metadata.');
    await client.query(ddl.join('\n'));
    await grantModelCatalogReadAccess(client, role.name);
    await writeModelCatalog(client, catalog);
    await client.query('COMMIT');
    reusable = true;
    return catalog.items.length;
  } catch (error) {
    try { await client.query('ROLLBACK'); reusable = true; } catch { reusable = false; }
    throw error;
  } finally { client.release(!reusable); }
}

export async function runModelCatalogCommand(command: string, file?: string, environment: NodeJS.ProcessEnv = process.env) {
  if (!['init', 'import'].includes(command) || (command === 'init' && file)) {
    throw new FobDatabaseError('invalid_config', 'Usage: bun backend/server/scripts/models-catalog.ts init | import [catalog.json]');
  }
  let catalog;
  if (command === 'import') {
    if (file) {
      try { catalog = validateModelCatalog(JSON.parse(await readFile(resolve(file), 'utf8'))); }
      catch (error) {
        if (error instanceof FobDatabaseError) throw error;
        throw new FobDatabaseError('invalid_config', 'The model catalog file could not be read as valid JSON.');
      }
    } else catalog = await readBundledModelCatalog();
  }
  const connections = await readFobDatabaseConnections(environment);
  const admin = new Pool({ connectionString: connections.admin, max: 1, connectionTimeoutMillis: 10_000 });
  const application = new Pool({ connectionString: connections.application, max: 1, connectionTimeoutMillis: 10_000 });
  for (const pool of [admin, application]) pool.on('error', () => {});
  try {
    if (command === 'import') await assertFobApplicationRole(admin, application);
    const count = command === 'init' ? await initializeModelCatalog(admin, application) : await importModelCatalog(admin, catalog);
    return { models: count, command };
  } finally { await Promise.all([admin.end(), application.end()]); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runModelCatalogCommand(process.argv[2] ?? '', process.argv[3]).then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
}
