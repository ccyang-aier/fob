import { Pool } from 'pg';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';

/** Additive only: preserve all existing accounts, visits and knowledge resources. */
async function main() {
  const connections = await readFobDatabaseConnections();
  const pool = new Pool({ connectionString: connections.admin, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
      await client.query('ALTER TABLE resources.document_visit ADD COLUMN IF NOT EXISTS study_seconds integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS study_heartbeat_at timestamptz');
      await client.query(`DO $upgrade$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='resources.document_visit'::regclass AND conname='document_visit_study_nonnegative') THEN
          ALTER TABLE resources.document_visit ADD CONSTRAINT document_visit_study_nonnegative CHECK (study_seconds >= 0);
        END IF;
      END $upgrade$`);
      await client.query('COMMIT');
      console.log('Profile learning storage is ready; existing data preserved.');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}
void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
