import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { applicationSchema } from '../src/platform/database/schema';
import { documentEdit } from '../src/platform/database/resources/schema';
import { resourceRlsSql } from '../src/platform/database/resources/rls';
import { documentActivityRetentionSql, trimExistingPageActivitySql } from '../src/platform/database/resources/activity-retention';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';
import { assertFobApplicationRole } from '../src/platform/database/initialize-role';

export async function upgradePageActivity(admin: Pool, application: Pool) {
  const role = await assertFobApplicationRole(admin, application);
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(applicationSchema, undefined, ['resources', 'auth', 'catalog']));
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    const exists = await client.query("SELECT to_regclass('resources.document_edit') AS relation");
    if (!exists.rows[0].relation) {
      for (const statement of statements.filter(statement => statement.includes('"resources"."document_edit"'))) await client.query(statement);
      await client.query(resourceRlsSql([documentEdit]));
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON resources.document_edit TO "${role.name.replaceAll('"', '""')}"`);
    }
    await client.query('CREATE INDEX IF NOT EXISTS document_visit_recent_idx ON resources.document_visit (knowledge_base_id,page_id,last_viewed_at,user_id)');
    await client.query(documentActivityRetentionSql);
    await client.query(`INSERT INTO resources.document_edit (knowledge_base_id,page_id,id,user_id,created_at)
      SELECT knowledge_base_id,page_id,id,user_id,created_at FROM (
        SELECT o.knowledge_base_id,p.id AS page_id,o.id,u.id AS user_id,o.created_at,
          row_number() OVER (PARTITION BY o.knowledge_base_id,p.id ORDER BY o.created_at DESC,o.id DESC) AS rank
        FROM resources.outbox o JOIN resources.page p ON p.knowledge_base_id=o.knowledge_base_id AND p.id::text=o.payload->>'pageId'
        LEFT JOIN auth."user" u ON u.id::text=o.payload->'actor'->>'userId'
        WHERE o.topic='doc.changed'
      ) recent WHERE rank<=20 ON CONFLICT DO NOTHING`);
    await client.query(trimExistingPageActivitySql);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function main() {
  const urls = await readFobDatabaseConnections();
  const admin = new Pool({ connectionString: urls.admin, max: 1 }), application = new Pool({ connectionString: urls.application, max: 1 });
  try { await upgradePageActivity(admin, application); console.log('Page activity upgraded; retained at most 20 readers, 20 edits and 15 versions per document.'); }
  finally { await Promise.all([admin.end(), application.end()]); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
