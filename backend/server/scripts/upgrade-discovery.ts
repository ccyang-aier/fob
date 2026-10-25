import { Pool } from 'pg';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';

async function main() {
  const connections = await readFobDatabaseConnections(), pool = new Pool({ connectionString: connections.admin, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
      await client.query("ALTER TABLE resources.teamspace ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb");
      await client.query('COMMIT');
      console.log('Folder metadata upgraded. Existing data preserved.');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}
void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
