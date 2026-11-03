import { Pool } from 'pg';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';
import { resourceRlsSql } from '../src/platform/database/resources/rls';
import { teamspaceMemberAccess } from '../src/platform/database/resources/schema';

/** Additive upgrade: existing folders retain their current independent defaults. */
async function main() {
  const connections = await readFobDatabaseConnections();
  const pool = new Pool({ connectionString: connections.admin, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    await client.query('ALTER TABLE resources.teamspace ADD COLUMN IF NOT EXISTS inherits_access boolean NOT NULL DEFAULT false');
    await client.query(`CREATE TABLE IF NOT EXISTS resources.teamspace_member_access (
      knowledge_base_id uuid NOT NULL, teamspace_id uuid NOT NULL, user_id uuid NOT NULL,
      level resources.permission_level NOT NULL,
      CONSTRAINT teamspace_member_access_pk PRIMARY KEY (knowledge_base_id, teamspace_id, user_id),
      CONSTRAINT teamspace_member_access_folder_fk FOREIGN KEY (knowledge_base_id, teamspace_id) REFERENCES resources.teamspace(knowledge_base_id, id) ON DELETE CASCADE,
      CONSTRAINT teamspace_member_access_member_fk FOREIGN KEY (knowledge_base_id, user_id) REFERENCES resources.knowledge_base_member(knowledge_base_id, user_id) ON DELETE CASCADE
    )`);
    await client.query(`DO $upgrade$ DECLARE old_name text; BEGIN
      SELECT conname INTO old_name FROM pg_constraint WHERE conrelid='resources.teamspace_member_access'::regclass AND contype='p';
      IF old_name <> 'teamspace_member_access_pk' THEN
        EXECUTE format('ALTER TABLE resources.teamspace_member_access RENAME CONSTRAINT %I TO teamspace_member_access_pk', old_name);
      END IF;
    END $upgrade$`);
    await client.query('DROP POLICY IF EXISTS knowledge_base_scope ON resources.teamspace_member_access');
    await client.query(resourceRlsSql([teamspaceMemberAccess]));
    const applicationRole = decodeURIComponent(new URL(connections.application).username);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON resources.teamspace_member_access TO "${applicationRole.replaceAll('"', '""')}"`);
    await client.query('COMMIT');
    console.log('Folder member access and inheritance ready; existing data preserved.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
