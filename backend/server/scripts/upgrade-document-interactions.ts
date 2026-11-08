import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { applicationSchema } from '../src/platform/database/schema';
import { coffeeTransfer, documentLike } from '../src/platform/database/resources/schema';
import { resourceRlsSql } from '../src/platform/database/resources/rls';
import { coffeeTransferGuardSql } from '../src/platform/database/resources/coffee-transfer-guard';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';
import { assertFobApplicationRole } from '../src/platform/database/initialize-role';

export async function upgradeDocumentInteractions(admin: Pool, application: Pool) {
  const role = await assertFobApplicationRole(admin, application);
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(applicationSchema, undefined, ['resources', 'auth', 'catalog']));
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    for (const [name, table] of [['document_like', documentLike], ['coffee_transfer', coffeeTransfer]] as const) {
      if (!(await client.query('SELECT to_regclass($1) AS relation', [`resources.${name}`])).rows[0].relation) {
        for (const statement of statements.filter(statement => statement.includes(`"resources"."${name}"`))) await client.query(statement);
        await client.query(resourceRlsSql([table]));
        await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON resources.${name} TO "${role.name.replaceAll('"', '""')}"`);
      }
    }
    await client.query(coffeeTransferGuardSql);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function main() {
  const urls = await readFobDatabaseConnections();
  const admin = new Pool({ connectionString: urls.admin, max: 1 }), application = new Pool({ connectionString: urls.application, max: 1 });
  try { await upgradeDocumentInteractions(admin, application); console.log('Document likes and account coffee transfers are ready.'); }
  finally { await Promise.all([admin.end(), application.end()]); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
