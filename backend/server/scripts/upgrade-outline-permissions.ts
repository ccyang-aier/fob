import { Pool } from 'pg';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';

/** Additive role upgrade; no existing membership, grant, document or privacy boundary is rewritten. */
async function main() {
  const connections = await readFobDatabaseConnections();
  const pool = new Pool({ connectionString: connections.admin, max: 1 });
  try {
    await pool.query("ALTER TYPE resources.member_role ADD VALUE IF NOT EXISTS 'viewer' BEFORE 'guest'");
    console.log('Viewer workspace role is ready; existing data preserved.');
  } finally { await pool.end(); }
}
void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
