import { Pool } from 'pg';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';

async function main() {
  const connections = await readFobDatabaseConnections();
  const pool = new Pool({ connectionString: connections.admin, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    await client.query('ALTER TABLE resources.teamspace ADD COLUMN IF NOT EXISTS parent_id uuid');
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'resources.teamspace'::regclass AND conname = 'teamspace_parent_fk') THEN
        ALTER TABLE resources.teamspace ADD CONSTRAINT teamspace_parent_fk FOREIGN KEY (knowledge_base_id, parent_id) REFERENCES resources.teamspace(knowledge_base_id, id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'resources.teamspace'::regclass AND conname = 'teamspace_parent_not_self') THEN
        ALTER TABLE resources.teamspace ADD CONSTRAINT teamspace_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
      END IF;
    END $$`);
    await client.query('CREATE INDEX IF NOT EXISTS teamspace_parent_idx ON resources.teamspace(knowledge_base_id, parent_id)');
    await client.query('COMMIT');
    console.log('Folder hierarchy enabled. Existing folders and documents preserved.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
