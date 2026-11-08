import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { documentActivitySchema, type PageScope } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { docCheckpoint, documentEdit, documentVisit } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { createPermissionsFixture, type PermissionsFixture, type PermissionTestActor } from '../permissions/permissions-test-fixture';
import { createDocumentCollaborationRoutes } from './http';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { prosemirrorDocToYDoc } from '../import-export/y-encoding';
import { upgradePageActivity } from '../../../../scripts/upgrade-page-activity';

let fixture: PermissionsFixture;
beforeAll(async () => {
  fixture = await createPermissionsFixture({ mount(app, deps) {
    app.route('/', createDocumentCollaborationRoutes({ ...deps, publicationSecret: 'activity-test-only-publication-secret' }));
  } });
}, 60_000);
afterAll(async () => { await fixture?.close(); }, 30_000);
beforeEach(async () => { await fixture.resetJobs(); });
const base = (scope: PageScope) => `/api/knowledge/${scope.knowledgeBaseId}/pages/${scope.pageId}/collaboration`;
function request(scope: PageScope, actor: PermissionTestActor, path = '/activity', body?: unknown) {
  return fetch(`${fixture.server.origin}${base(scope)}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { cookie: actor.cookie, origin: fixture.server.webOrigin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function count(table: string, scope: PageScope) {
  return Number((await fixture.admin.query(`SELECT count(*) FROM resources.${table} WHERE knowledge_base_id=$1 AND page_id=$2`, [scope.knowledgeBaseId, scope.pageId])).rows[0].count);
}

test('retains twenty distinct recent readers in storage, updates repeat visits, and preserves other pages', async () => {
  const { root, pages } = await fixture.tree(); await fixture.drain();
  const readers = Array.from({ length: 25 }, (_, index) => ({ id: randomUUID(), name: `Viewer ${index}` }));
  for (const reader of readers) await fixture.admin.query('INSERT INTO auth."user" (id,name,email) VALUES ($1,$2,$3)', [reader.id, reader.name, `${reader.id}@activity.test`]);
  await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, async db => {
    await db.insert(documentVisit).values(readers.map((reader, index) => ({ ...root, userId: reader.id, lastViewedAt: new Date(Date.now() - 3_600_000 - (25 - index) * 1000) })));
    await db.insert(documentVisit).values({ ...pages[1]!, userId: readers[0]!.id });
  });
  expect(await count('document_visit', root)).toBe(20);
  expect(await count('document_visit', pages[1]!)).toBe(1);
  const initial = documentActivitySchema.parse(await (await request(root, fixture.owner)).json());
  expect(initial.readers).toHaveLength(20);
  expect(initial.readers[0]!.userId).toBe(readers[24]!.id);
  expect(initial.readers.some(reader => reader.userId === readers[0]!.id)).toBe(false);
  expect((await request(root, fixture.owner, '/visits', {})).status).toBe(200);
  expect((await request(root, fixture.owner, '/visits', {})).status).toBe(200);
  const repeated = documentActivitySchema.parse(await (await request(root, fixture.owner)).json());
  expect(repeated.readers).toHaveLength(20);
  expect(repeated.readers.filter(reader => reader.userId === fixture.owner.identity.userId)).toHaveLength(1);
  expect(repeated.readers[0]!.name).toBe('owner');
  const [visit] = await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.select().from(documentVisit).where(and(eq(documentVisit.pageId, root.pageId), eq(documentVisit.userId, fixture.owner.identity.userId))));
  expect(visit!.views).toBe(1);
});

test('persists only twenty committed edits without duplicating idempotent outbox events', async () => {
  const { root } = await fixture.tree(); await fixture.drain();
  const events = Array.from({ length: 26 }, (_, index) => ({ id: randomUUID(), occurredAt: new Date(Date.now() + index * 1000).toISOString() }));
  for (const event of events) await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => appendKnowledgeOutbox(db, { ...root, topic: 'doc.changed', actor: { kind: 'human', userId: fixture.owner.identity.userId }, occurredAt: event.occurredAt }, event.id));
  const latest = events[25]!;
  await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => appendKnowledgeOutbox(db, { ...root, topic: 'doc.changed', actor: { kind: 'human', userId: fixture.owner.identity.userId }, occurredAt: latest.occurredAt }, latest.id));
  expect(await count('document_edit', root)).toBe(20);
  const activity = documentActivitySchema.parse(await (await request(root, fixture.owner)).json());
  expect(activity.edits.map(entry => entry.id)).toEqual(events.slice(6).reverse().map(entry => entry.id));
  expect(activity.edits.every(entry => entry.name === 'owner')).toBe(true);
  const jobs = await fixture.admin.query('SELECT count(*) FROM resources.outbox WHERE knowledge_base_id=$1 AND id=ANY($2::uuid[])', [root.knowledgeBaseId, events.map(event => event.id)]);
  expect(Number(jobs.rows[0].count)).toBe(26);
});

test('database retains fifteen newest versions, and the upgrade cleans existing excess rows', async () => {
  const { root } = await fixture.tree(); await fixture.drain();
  const snapshot = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [knowledgeSchema.node('paragraph', null, [knowledgeSchema.text('Retained content')])]));
  try {
    await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.insert(docCheckpoint).values(Array.from({ length: 22 }, (_, index) => ({ ...root, id: randomUUID(), state: snapshot.state, stateVector: snapshot.stateVector, authors: [fixture.owner.identity.userId], createdAt: new Date(Date.now() + index * 1000) }))));
    expect(await count('doc_checkpoint', root)).toBe(15);
    await fixture.admin.query('ALTER TABLE resources.doc_checkpoint DISABLE TRIGGER doc_checkpoint_retention');
    await withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.insert(docCheckpoint).values(Array.from({ length: 5 }, () => ({ ...root, id: randomUUID(), state: snapshot.state, stateVector: snapshot.stateVector, authors: [] }))));
    expect(await count('doc_checkpoint', root)).toBe(20);
    await upgradePageActivity(fixture.admin, fixture.pool);
    expect(await count('doc_checkpoint', root)).toBe(15);
  } finally { snapshot.ydoc.destroy(); }
}, 30_000);

test('activity uses live page permissions and cannot reveal a foreign knowledge base', async () => {
  const { root } = await fixture.tree({ defaultAccess: null }); await fixture.drain();
  expect([401, 403]).toContain((await request(root, fixture.foreign)).status);
  expect((await request(root, fixture.reader)).status).toBe(403);
  expect((await request(root, fixture.owner)).status).toBe(200);
  await withKnowledgeBase(fixture.pool, fixture.beta.id, async db => {
    expect(await db.select().from(documentEdit).where(eq(documentEdit.pageId, root.pageId))).toEqual([]);
  });
});

test('concurrent ordinary-role writes cannot exceed any activity cap', async () => {
  const { root } = await fixture.tree(); await fixture.drain();
  const ids = Array.from({ length: 25 }, () => randomUUID());
  await fixture.admin.query('INSERT INTO auth."user" (id,name,email) SELECT id,\'Concurrent viewer\',id::text || \'@activity.test\' FROM unnest($1::uuid[]) id', [ids]);
  await Promise.all(ids.map(userId => withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.insert(documentVisit).values({ ...root, userId }))));
  expect(await count('document_visit', root)).toBe(20);
  await Promise.all(ids.map(id => withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.insert(documentEdit).values({ ...root, id, userId: fixture.owner.identity.userId }))));
  expect(await count('document_edit', root)).toBe(20);
  const snapshot = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [knowledgeSchema.node('paragraph')]));
  try {
    await Promise.all(ids.map(() => withKnowledgeBase(fixture.pool, root.knowledgeBaseId, db => db.insert(docCheckpoint).values({ ...root, id: randomUUID(), state: snapshot.state, stateVector: snapshot.stateVector, authors: [] }))));
    expect(await count('doc_checkpoint', root)).toBe(15);
  } finally { snapshot.ydoc.destroy(); }
}, 30_000);
