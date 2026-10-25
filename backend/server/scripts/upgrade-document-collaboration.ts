import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { applicationSchema } from '../src/platform/database/schema';
import { documentInvitation, documentVisit } from '../src/platform/database/resources/schema';
import { resourceRlsSql } from '../src/platform/database/resources/rls';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';
import { assertFobApplicationRole } from '../src/platform/database/initialize-role';

/** Additive upgrade only: existing documents, accounts, ACLs and Yjs states survive. */
export async function upgradeDocumentCollaboration(admin: Pool, application: Pool) {
  const role = await assertFobApplicationRole(admin, application);
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(applicationSchema, undefined, ['resources', 'auth', 'catalog']));
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    await client.query('ALTER TABLE resources.share_link ADD COLUMN IF NOT EXISTS encrypted_token bytea');
    await client.query('ALTER TABLE resources.doc_checkpoint ADD COLUMN IF NOT EXISTS title varchar(500)');
    for (const [name, table] of [['document_visit', documentVisit], ['document_invitation', documentInvitation]] as const) {
      const existing = await client.query('SELECT to_regclass($1) AS relation', [`resources.${name}`]);
      if (existing.rows[0].relation) continue;
      const related = statements.filter(statement => statement.includes(`"resources"."${name}"`));
      for (const statement of related) await client.query(statement);
      await client.query(resourceRlsSql([table]));
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON resources."${name}" TO "${role.name.replaceAll('"', '""')}"`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function main() {
  const urls = await readFobDatabaseConnections();
  const admin = new Pool({ connectionString: urls.admin, max: 1 }), application = new Pool({ connectionString: urls.application, max: 1 });
  try { await upgradeDocumentCollaboration(admin, application); console.log('Document collaboration schema upgraded. Existing data preserved.'); }
  finally { await Promise.all([admin.end(), application.end()]); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
