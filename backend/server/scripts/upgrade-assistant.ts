import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { applicationSchema, assistantPreference, assistantConnection, knowledgeBaseModelCredential } from '../src/platform/database/schema';
import { migrateKnowledgeBaseAI } from './migrate-knowledge-base-ai';
import { resourceRlsSql } from '../src/platform/database/resources/rls';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';
import { assertFobApplicationRole } from '../src/platform/database/initialize-role';

export async function upgradeAssistant(admin: Pool, application: Pool, key: Uint8Array) {
  const role = await assertFobApplicationRole(admin, application);
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(applicationSchema, undefined, ['resources', 'auth', 'catalog']));
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    const missing = [];
    for (const table of [knowledgeBaseModelCredential, assistantPreference, assistantConnection]) {
      const name = getTableConfig(table).name;
      if (!(await client.query('SELECT to_regclass($1) AS relation', [`resources.${name}`])).rows[0].relation) missing.push({ name, table });
    }
    for (const { name } of missing) for (const statement of statements.filter(value => value.startsWith(`CREATE TABLE "resources"."${name}"`))) await client.query(statement);
    for (const { name, table } of missing) {
      for (const statement of statements.filter(value => value.startsWith(`ALTER TABLE "resources"."${name}"`) || value.includes(` ON "resources"."${name}" `))) await client.query(statement);
      await client.query(resourceRlsSql([table]));
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON resources."${name}" TO "${role.name.replaceAll('"', '""')}"`);
    }
    await migrateKnowledgeBaseAI(client, key);
    // Preserve account data outside the current runtime catalog with no application access.
    for (const name of ['assistant_preference', 'assistant_connection']) {
      if (!(await client.query('SELECT to_regclass($1) AS relation', [`resources.${name}`])).rows[0].relation) continue;
      await client.query('CREATE SCHEMA IF NOT EXISTS fob_archive');
      await client.query(`REVOKE ALL ON SCHEMA fob_archive FROM PUBLIC, "${role.name.replaceAll('"', '""')}"`);
      await client.query(`ALTER TABLE resources."${name}" SET SCHEMA fob_archive`);
      await client.query(`REVOKE ALL ON TABLE fob_archive."${name}" FROM PUBLIC, "${role.name.replaceAll('"', '""')}"`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function main() {
  const urls = await readFobDatabaseConnections(), admin = new Pool({ connectionString: urls.admin, max: 1 }), app = new Pool({ connectionString: urls.application, max: 1 });
  try {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error('The existing Fob authentication secret is required to migrate encrypted AI credentials.');
    await upgradeAssistant(admin, app, createHash('sha256').update(`fob:model-credentials:${secret}`).digest());
    console.log('Knowledge-base AI configuration is ready. Administrator settings migrated; legacy account data preserved.');
  }
  finally { await Promise.all([admin.end(), app.end()]); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(error => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
