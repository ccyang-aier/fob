import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { createDevelopmentKnowledgeBases, developmentId } from '@fob/shared/development-workbench';
import { repairBlockIds } from '@fob/shared/knowledge/schema';
import { readFobDatabaseConnections, fobDatabaseErrorMessage } from '../src/platform/database/initialize-config';
import { assertFobApplicationRole } from '../src/platform/database/initialize-role';
import { installResourceRls } from '../src/platform/database/resources/rls';
import * as tables from '../src/platform/database/resources/schema';
import { resourceSchema } from '../src/platform/database/schema';
import { authUser } from '../src/platform/database/identity/schema';
import { markdownSchema } from '../src/modules/knowledge/import-export/body';
import { prosemirrorDocToYDoc } from '../src/modules/knowledge/import-export/y-encoding';

/** Explicit development reset: business fixtures only, accounts and sessions survive. */
export async function seedDevelopmentWorkbench() {
  if (process.env.NODE_ENV === 'production') throw new Error('Development fixtures cannot run in production.');
  const connections = await readFobDatabaseConnections();
  const target = new URL(connections.admin);
  // The development PostgreSQL instance may run in the local WSL private network.
  const localHost = target.hostname === 'localhost' || target.hostname === '127.0.0.1' || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(target.hostname);
  if (target.pathname !== '/fob' || !localHost) {
    throw new Error('This command only resets the local fob development database.');
  }
  const admin = new Pool({ connectionString: connections.admin, max: 1 });
  const application = new Pool({ connectionString: connections.application, max: 1 });
  const role = await assertFobApplicationRole(admin, application);
  const client = await admin.connect();
  try {
    const ddl = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(resourceSchema, undefined, ['resources']));
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fob:database:initialize'))");
    await client.query('DROP SCHEMA IF EXISTS resources CASCADE');
    await client.query(ddl.join('\n'));
    await installResourceRls(client);
    const name = `"${role.name.replaceAll('"', '""')}"`;
    await client.query(`REVOKE ALL ON SCHEMA resources FROM PUBLIC; GRANT USAGE ON SCHEMA resources TO ${name}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA resources TO ${name}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA resources TO ${name}`);
    const db = drizzle(client);
    const adminEmail = (process.env.FOB_ADMIN_EMAIL ?? 'admin@fob.local').toLowerCase();
    const [adminUser] = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, adminEmail));
    if (!adminUser) throw new Error(`Create the built-in admin account before seeding development knowledgeBases: ${adminEmail}`);
    const fixtures = createDevelopmentKnowledgeBases();
    const schema = markdownSchema();
    const projectId = developmentId(0x50000000, 1);
    await db.insert(tables.project).values({ id: projectId, name: 'Fob 知识工作台', createdBy: adminUser.id });
    await db.insert(tables.projectMember).values({ projectId, userId: adminUser.id, role: 'owner' });
    for (const base of fixtures) {
      await db.insert(tables.knowledgeBase).values({ id: base.id, name: base.name });
      await db.insert(tables.member).values({ knowledgeBaseId: base.id, userId: adminUser.id, role: 'owner' });
      await db.insert(tables.knowledgeBaseProject).values({ knowledgeBaseId: base.id, projectId });
      if (base.folders.length) await db.insert(tables.teamspace).values(base.folders.map((folder) => ({ ...folder, defaultAccess: 'edit' as const })));
      for (const [position, document] of base.documents.entries()) {
        const scope = { knowledgeBaseId: base.id, pageId: document.id };
        const principals = [`knowledgeBase:${base.id}` as const];
        await db.insert(tables.page).values({ knowledgeBaseId: base.id, id: document.id, teamspaceId: document.folderId,
          path: document.id.replaceAll('-', '_'), position: `a${String(position).padStart(4, '0')}`, title: document.title,
          createdBy: adminUser.id, updatedAt: new Date(document.updatedAt),
          properties: { displayCreator: document.creator, fileSource: document.source, indexStatus: document.indexStatus },
        });
        const node = repairBlockIds(schema.nodeFromJSON(document.body)).doc;
        const encoded = prosemirrorDocToYDoc(node);
        await db.insert(tables.docState).values({ ...scope, state: encoded.state, stateVector: encoded.stateVector });
        encoded.ydoc.destroy();
        await db.insert(tables.pageEffectiveAcl).values({ ...scope, view: principals, comment: principals, edit: principals });
        const blocks: (typeof tables.blockIndex.$inferInsert)[] = [];
        node.forEach((block) => {
          const text = block.textContent;
          blocks.push({ ...scope, blockId: block.attrs.blockId, blockType: block.type.name, contentMd: text,
            contentHash: createHash('sha256').update(text).digest('hex'), principals });
        });
        await db.insert(tables.blockIndex).values(blocks);
      }
    }
    // Development jobs referring to the discarded fixtures must not retry forever.
    const queue = await client.query("SELECT to_regclass('knowledge_jobs._private_jobs') AS table_name");
    if (queue.rows[0].table_name) await client.query('DELETE FROM knowledge_jobs._private_jobs');
    await client.query('COMMIT');
    const documentCount = fixtures.reduce((sum, base) => sum + base.documents.length, 0);
    console.log(`Development workbench ready: ${fixtures.length} knowledge bases, ${documentCount} documents. Accounts preserved.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); await Promise.all([admin.end(), application.end()]); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--reset') throw new Error('Use --reset to rebuild the local development business data.');
  seedDevelopmentWorkbench().catch((error: unknown) => { console.error(fobDatabaseErrorMessage(error)); process.exitCode = 1; });
}
