import { Pool } from 'pg';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';

/** Additive upgrade for an existing Fob database; no account data is replaced. */
async function main() {
  const connections = await readFobDatabaseConnections();
  const pool = new Pool({ connectionString: connections.admin,max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
      await client.query("ALTER TABLE auth.\"user\" ADD COLUMN IF NOT EXISTS signature varchar(160) NOT NULL DEFAULT ''");
      await client.query('COMMIT');
      console.log('Account signature storage is ready.');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}
void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
