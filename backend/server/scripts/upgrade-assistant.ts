import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { applicationSchema, assistantPreference } from '../src/platform/database/schema';
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
    if (!(await client.query("SELECT to_regclass('resources.assistant_preference') AS relation")).rows[0].relation) {
      for (const statement of statements.filter(statement => statement.includes('"resources"."assistant_preference"'))) await client.query(statement);
      await client.query(resourceRlsSql([assistantPreference]));
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON resources.assistant_preference TO "${role.name.replaceAll('"', '""')}"`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function main() {
  const urls = await readFobDatabaseConnections(), admin = new Pool({ connectionString: urls.admin, max: 1 }), app = new Pool({ connectionString: urls.application, max: 1 });
  try { await upgradeAssistant(admin, app); console.log('Assistant preferences are ready. Existing content is preserved.'); }
  finally { await Promise.all([admin.end(), app.end()]); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
