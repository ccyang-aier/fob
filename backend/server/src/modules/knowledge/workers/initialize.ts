import { runMigrations } from 'graphile-worker';
import type { Pool } from 'pg';
import { assertFobApplicationRole } from '../../../platform/database/initialize-role';
import { knowledgeWorkerLogger } from './logger';
import { guardKnowledgeWorkerPool } from './pool-errors';

export const KNOWLEDGE_JOBS_SCHEMA = 'knowledge_jobs';
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Administrator-only bootstrap of the pinned third-party queue schema. These are
 * Graphile's internal migrations, not an application data compatibility layer.
 * Runtime uses only the ordinary application role and cannot run DDL/migrations.
 */
export async function initializeKnowledgeJobs(admin: Pool, application: Pool): Promise<void> {
  const role = await assertFobApplicationRole(admin, application);
  const releaseErrors = guardKnowledgeWorkerPool(admin);
  try { await runMigrations({ pgPool: admin, schema: KNOWLEDGE_JOBS_SCHEMA, logger: knowledgeWorkerLogger() }); }
  finally { releaseErrors(); }
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const grantee = identifier(role.name);
    await client.query(`
      REVOKE ALL ON SCHEMA knowledge_jobs FROM PUBLIC, ${grantee};
      GRANT USAGE ON SCHEMA knowledge_jobs TO ${grantee};
      REVOKE ALL ON ALL TABLES IN SCHEMA knowledge_jobs FROM PUBLIC, ${grantee};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA knowledge_jobs TO ${grantee};
      REVOKE INSERT, UPDATE, DELETE ON knowledge_jobs.migrations FROM ${grantee};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA knowledge_jobs FROM PUBLIC, ${grantee};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA knowledge_jobs TO ${grantee};
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge_jobs FROM PUBLIC, ${grantee};
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA knowledge_jobs TO ${grantee};
    `);
    // Graphile enables RLS with no policies because it normally runs as owner.
    // Queue infrastructure is server-global; only the named runtime role can use
    // these tables. Actual event bodies remain behind resources.* resource RLS.
    const queueTables = await client.query<{ name: string }>(`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='knowledge_jobs' AND c.relkind='r' AND c.relrowsecurity
    `);
    for (const table of queueTables.rows) {
      const target = `knowledge_jobs.${identifier(table.name)}`;
      await client.query(`
        ALTER TABLE ${target} FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS worker_runtime ON ${target};
        CREATE POLICY worker_runtime ON ${target} FOR ALL TO ${grantee} USING (true) WITH CHECK (true);
      `);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
