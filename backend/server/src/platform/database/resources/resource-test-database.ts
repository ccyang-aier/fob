import { authUser } from '../identity/schema';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { initializeFobDatabase } from '../initialize';
import { readFobDatabaseConnections } from '../initialize-config';
import { assertFobApplicationRole } from '../initialize-role';
import * as tables from '../schema';

const databaseNamePattern = /^fob_rls_[a-f0-9]{32}$/;
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Only databases created by this invocation can be removed by this closure. */
export async function createResourceTestDatabase(options: { initialize?: boolean } = {}) {
  const urls = await readFobDatabaseConnections();
  const name = `fob_rls_${randomUUID().replaceAll('-', '')}`;
  if (!databaseNamePattern.test(name)) throw new Error('Invalid disposable database name');
  const maintenance = new Pool({ connectionString: urls.admin.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  const databaseAdminUrl = new URL(urls.admin);
  const applicationUrl = new URL(urls.application);
  databaseAdminUrl.pathname = `/${name}`;
  applicationUrl.pathname = `/${name}`;
  const admin = new Pool({ connectionString: databaseAdminUrl.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  const pool = new Pool({ connectionString: applicationUrl.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  const idleErrors: Error[] = [];
  for (const source of [maintenance, admin, pool]) source.on('error', (error) => idleErrors.push(error));
  let created = false;
  let disposed = false;

  async function dispose() {
    if (disposed) return;
    await Promise.all([pool.end(), admin.end()]);
    try {
      if (created) {
        if (!databaseNamePattern.test(name)) throw new Error('Refusing to remove an unrecognized database');
        await maintenance.query(`DROP DATABASE ${identifier(name)} WITH (FORCE)`);
        created = false;
        const remains = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
        if (remains.rowCount !== 0) throw new Error('Disposable database cleanup did not complete');
        console.log(`Removed disposable resource-test database ${name}.`);
      }
    } finally {
      disposed = true;
      await maintenance.end();
    }
  }

  try {
    await maintenance.query(`CREATE DATABASE ${identifier(name)} TEMPLATE template0`);
    created = true;
    console.log(`Created disposable resource-test database ${name}.`);
    const role = await assertFobApplicationRole(admin, pool);
    if (options.initialize !== false) await initializeFobDatabase(admin, pool);
    return { name, admin, pool, role, idleErrors, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export type ResourceTestDatabase = Awaited<ReturnType<typeof createResourceTestDatabase>>;

export async function seedResourceTestData(admin: Pool) {
  // The same page/group/etc. UUIDs intentionally occur in both resources. Only the
  // composite knowledgeBase key may distinguish them in joins and foreign keys.
  const ids = {
    knowledgeBase: randomUUID(), teamspace: randomUUID(), group: randomUUID(), page: randomUUID(), database: randomUUID(), row: randomUUID(),
    checkpoint: randomUUID(), thread: randomUUID(), comment: randomUUID(), task: randomUUID(), usage: randomUUID(),
    notification: randomUUID(), outbox: randomUUID(), pat: randomUUID(), share: randomUUID(), credential: randomUUID(),
  };
  const resources = [
    { knowledgeBaseId: randomUUID(), userId: randomUUID(), name: 'Resource Alpha' },
    { knowledgeBaseId: randomUUID(), userId: randomUUID(), name: 'Resource Beta' },
  ] as const;
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const db = drizzle(client, { schema: tables.resourceSchema });
    for (const resource of resources) {
      const { knowledgeBaseId, userId, name } = resource;
      const principal = `user:${userId}` as const;
      await db.insert(authUser).values({ id: userId, name, email: `${userId}@resource.test` });
      await db.insert(tables.knowledgeBase).values({ id: knowledgeBaseId, name });
      await db.insert(tables.member).values({ knowledgeBaseId, userId, role: 'owner' });
      await db.insert(tables.knowledgeBaseInvitation).values({
        knowledgeBaseId, id: randomUUID(), email: 'invitee@resource.test', role: 'member', tokenHash: 'd'.repeat(64),
        invitedBy: userId, expiresAt: new Date(Date.now() + 86_400_000),
      });
      await db.insert(tables.group).values({ knowledgeBaseId, id: ids.group, name: 'Editors' });
      await db.insert(tables.groupMember).values({ knowledgeBaseId, groupId: ids.group, userId });

      await db.insert(tables.teamspace).values({ knowledgeBaseId, id: ids.teamspace, name: 'Team', defaultAccess: 'view' });
      const metadata = { knowledgeBaseId, teamspaceId: ids.teamspace, createdBy: userId };
      await db.insert(tables.page).values([
        { ...metadata, id: ids.page, kind: 'doc', path: ids.page.replaceAll('-', '_'), position: 'a0', title: `${name} document` },
        { ...metadata, id: ids.database, kind: 'database', path: ids.database.replaceAll('-', '_'), position: 'a1', title: `${name} database` },
      ]);
      await db.insert(tables.databaseDefinition).values({ knowledgeBaseId, pageId: ids.database, teamspaceId: ids.teamspace });
      await db.insert(tables.page).values({
        ...metadata, id: ids.row, parentId: ids.database, databaseId: ids.database, kind: 'row', position: 'a0',
        path: `${ids.database}.${ids.row}`.replaceAll('-', '_'), title: `${name} row`,
      });
      const scope = { knowledgeBaseId, pageId: ids.page };
      const state = { state: new Uint8Array([0, 0]), stateVector: new Uint8Array([0]) };
      await db.insert(tables.docState).values({ ...scope, ...state });
      await db.insert(tables.docCheckpoint).values({ ...scope, ...state, id: ids.checkpoint, authors: [userId] });
      await db.insert(tables.pageAcl).values({ ...scope, principal, level: 'full' });
      await db.insert(tables.pageEffectiveAcl).values({ ...scope, view: [principal], comment: [principal], edit: [principal], full: [principal] });
      await db.insert(tables.blockIndex).values({
        ...scope, blockId: 'block-1', blockType: 'paragraph', contentMd: `${name} private block`, contentHash: 'a'.repeat(64),
        embedding: [1, 2], embedModel: 'previous-model', embedDimensions: 2, embeddedHash: 'a'.repeat(64), principals: [principal],
      });
      await db.insert(tables.blockEmbeddingModel).values({ knowledgeBaseId, embedModel: 'previous-model', embedDimensions: 2 });
      await db.insert(tables.blockEmbeddingStaging).values({
        ...scope, blockId: 'block-1', contentHash: 'a'.repeat(64), embedding: [1, 2, 3], embedModel: 'replacement-model', embedDimensions: 3,
      });
      await db.insert(tables.backlink).values({ knowledgeBaseId, srcPageId: ids.page, srcBlockId: 'block-1', dstKnowledgeBaseId: knowledgeBaseId, dstPageId: ids.database });
      await db.insert(tables.asset).values({ knowledgeBaseId, hash: 'f'.repeat(64), mime: 'text/plain', size: 4 });
      await db.insert(tables.commentThread).values({ ...scope, id: ids.thread });
      await db.insert(tables.comment).values({ knowledgeBaseId, id: ids.comment, threadId: ids.thread, authorId: userId, bodyMd: `${name} comment` });
      await db.insert(tables.commentLike).values({ knowledgeBaseId, commentId: ids.comment, userId });
      await db.insert(tables.outbox).values({
        knowledgeBaseId, id: ids.outbox, topic: 'doc.changed',
        payload: { ...scope, topic: 'doc.changed', actor: { kind: 'human', userId }, occurredAt: new Date().toISOString() },
      });
      await db.insert(tables.aiTask).values({ knowledgeBaseId, id: ids.task, initiatedBy: userId, kind: 'chat' });
      await db.insert(tables.aiUsage).values({ knowledgeBaseId, id: ids.usage, userId, taskId: ids.task, operation: 'generate', status: 'success', tier: 'smart', provider: 'local', model: 'test', durationMs: 1 });
      await db.insert(tables.notification).values({ ...scope, id: ids.notification, userId, kind: 'mention', payload: {} });
      await db.insert(tables.personalAccessToken).values({ knowledgeBaseId, id: ids.pat, userId, name: 'Test', tokenHash: 'b'.repeat(64), scopes: ['read'] });
      await db.insert(tables.shareLink).values({ ...scope, id: ids.share, tokenHash: 'c'.repeat(64), createdBy: userId });
      await db.insert(tables.modelCredential).values({ knowledgeBaseId, id: ids.credential, userId, provider: 'openai', encryptedSecret: new Uint8Array([1, 2, 3]) });
    }
    await client.query('COMMIT');
    return { resources, ids };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
