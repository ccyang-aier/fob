import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { applicationSchema, assistantPreference, assistantConnection } from '../src/platform/database/schema';
import { resourceRlsSql } from '../src/platform/database/resources/rls';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';
import { assertFobApplicationRole } from '../src/platform/database/initialize-role';

export async function upgradeAssistant(admin: Pool, application: Pool) {
  const role = await assertFobApplicationRole(admin, application);
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(applicationSchema, undefined, ['resources', 'auth', 'catalog']));
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    for (const definition of [{ name: 'assistant_preference', table: assistantPreference }, { name: 'assistant_connection', table: assistantConnection }]) {
      if ((await client.query('SELECT to_regclass($1) AS relation', [`resources.${definition.name}`])).rows[0].relation) continue;
      for (const statement of statements.filter(statement => statement.includes(`"resources"."${definition.name}"`))) await client.query(statement);
      await client.query(resourceRlsSql([definition.table]));
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON resources."${definition.name}" TO "${role.name.replaceAll('"', '""')}"`);
    }
    const constraints = await client.query<{ conname: string }>("SELECT conname FROM pg_constraint WHERE conrelid='resources.assistant_connection'::regclass AND confrelid='resources.model_credential'::regclass AND contype='f'");
    if (constraints.rows.length !== 1) throw new Error('Assistant connection credential constraint is unavailable.');
    if (constraints.rows[0]!.conname !== 'assistant_connection_credential_fk') await client.query(`ALTER TABLE resources.assistant_connection RENAME CONSTRAINT "${constraints.rows[0]!.conname.replaceAll('"', '""')}" TO assistant_connection_credential_fk`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function main() {
  const urls = await readFobDatabaseConnections(), admin = new Pool({ connectionString: urls.admin, max: 1 }), app = new Pool({ connectionString: urls.application, max: 1 });
  try { await upgradeAssistant(admin, app); console.log('Assistant preferences and private provider connections are ready. Existing content is preserved.'); }
  finally { await Promise.all([admin.end(), app.end()]); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
