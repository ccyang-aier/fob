import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { discoveryFacetsSchema, discoverySearchResultSchema, folderOverviewSchema, type PageScope } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { createPermissionsFixture, type PermissionsFixture, type PermissionTestActor } from '../permissions/permissions-test-fixture';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { docState, documentVisit, page } from '../../../platform/database/resources/schema';
import { prosemirrorDocToYDoc } from '../import-export/y-encoding';
import { refreshPageBlockIndex } from '../search/indexer';
import { createKnowledgeDiscoveryRoutes } from './http';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture({ mount(app, deps) { app.route('/', createKnowledgeDiscoveryRoutes({ ...deps, trustedOrigins: deps.auth.options.trustedOrigins as string[] })); } }); }, 60_000);
afterAll(async () => { await fixture?.close(); }, 30_000);
function request(path: string, actor = fixture.owner, body?: unknown, method = 'POST') {
  return fetch(`${fixture.server.origin}/api/knowledge/${fixture.alpha.id}/discovery/${path}`, { method: body === undefined ? 'GET' : method, headers: { origin: fixture.server.webOrigin, cookie: actor.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function seed(scope: PageScope, title: string, text: string, actor: PermissionTestActor = fixture.owner) {
  const encoded = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [knowledgeSchema.node('paragraph', { blockId: 'content' }, [knowledgeSchema.text(text)])]));
  try { await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async db => {
    await db.update(page).set({ title, createdBy: actor.identity.userId }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
    await db.insert(docState).values({ ...scope, state: encoded.state, stateVector: encoded.stateVector }).onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state: encoded.state, stateVector: encoded.stateVector, updatedAt: new Date() } });
    await refreshPageBlockIndex(db, { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId });
  }); } finally { encoded.ydoc.destroy(); }
}
test('title and body search intersect folder and author filters before ranking and limiting', async () => {
  const noisy = await fixture.tree({ defaultAccess: 'view', parents: [null, ...Array.from({ length: 54 }, () => 0)] });
  const target = await fixture.tree({ defaultAccess: 'view', parents: [null, 0] }); await fixture.drain();
  for (const scope of noisy.pages) await seed(scope, 'Noise', 'needle needle needle unrelated strong match');
  await seed(target.pages[0], 'Research', 'A quiet needle in the body', fixture.reader);
  await seed(target.pages[1], 'Needle title', 'A different body');
  const input = { query: 'needle', folderId: target.teamspace.id, authorId: fixture.reader.identity.userId };
  const response = await request('search', fixture.owner, input); expect(response.status).toBe(200);
  const result = discoverySearchResultSchema.parse(await response.json());
  expect(result.documents.map(document => document.id)).toEqual([target.pages[0].pageId]); expect(result.documents[0]!.snippet).toContain('needle');
  const titles = discoverySearchResultSchema.parse(await (await request('search', fixture.owner, { query: 'Needle title', folderId: target.teamspace.id })).json());
  expect(titles.documents.map(document => document.id)).toContain(target.pages[1].pageId);
  const filterOnly = discoverySearchResultSchema.parse(await (await request('search', fixture.owner, { folderId: target.teamspace.id, authorId: fixture.owner.identity.userId })).json());
  expect(filterOnly.documents.map(document => document.id)).toEqual([target.pages[1].pageId]);
}, 30_000);
test('all seven folder tabs expose real order, totals, readership and stable pagination', async () => {
  const tree = await fixture.tree({ defaultAccess: 'view', parents: [null, ...Array.from({ length: 44 }, () => 0)] }); await fixture.drain();
  for (const [index, scope] of tree.pages.entries()) await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, db => db.update(page).set({ title: `Document ${String(index).padStart(2, '0')}`, updatedAt: new Date(Date.UTC(2026, 0, index + 1)), createdAt: new Date(Date.UTC(2025, 0, index + 1)) }).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId))));
  await withKnowledgeBase(fixture.pool, tree.root.knowledgeBaseId, db => db.insert(documentVisit).values({ ...tree.pages[4], userId: fixture.owner.identity.userId, views: 7 }));
  const get = async (tab: string, offset = 0) => folderOverviewSchema.parse(await (await request(`folders/${tree.teamspace.id}?tab=${tab}&offset=${offset}`)).json());
  const alphabetical = await get('alphabetical'); expect(alphabetical.total).toBe(45); expect(alphabetical.documents).toHaveLength(40); expect(alphabetical.nextOffset).toBe(40); expect(alphabetical.documents[0]!.title).toBe('Document 00');
  const last = await get('alphabetical', 40); expect(last.documents).toHaveLength(5); expect(last.nextOffset).toBeNull();
  expect(new Set([...alphabetical.documents, ...last.documents].map(document => document.id)).size).toBe(45);
  expect((await get('popular')).documents[0]!.views).toBe(7);
  expect((await get('oldest')).documents[0]!.title).toBe('Document 00');
  expect((await get('updated')).documents[0]!.title).toBe('Document 44');
  expect((await get('published')).documents[0]!.title).toBe('Document 44');
  expect((await get('documents')).documents).toHaveLength(1); expect((await get('overview')).documents).toHaveLength(6);
}, 20_000);
test('overview edits persist, protect revisions, and reject cross-folder pins and read-only writers', async () => {
  const tree = await fixture.tree({ defaultAccess: 'view' }), other = await fixture.tree({ defaultAccess: 'view' }); await fixture.drain();
  const path = `folders/${tree.teamspace.id}`, description = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A real folder description' }] }] };
  expect((await request(path, fixture.owner, { expectedRevision: 0, description, pinnedPageIds: [tree.root.pageId], name: 'Research notes' }, 'PATCH')).status).toBe(200);
  const persisted = folderOverviewSchema.parse(await (await request(path)).json()); expect(persisted.folder.name).toBe('Research notes'); expect(persisted.folder.metadata.description).toEqual(description); expect(persisted.pinned[0]!.id).toBe(tree.root.pageId);
  expect((await request(path, fixture.owner, { expectedRevision: 0, name: 'Stale change' }, 'PATCH')).status).toBe(409);
  expect((await request(path, fixture.owner, { expectedRevision: 1, pinnedPageIds: [other.root.pageId] }, 'PATCH')).status).toBe(403);
  expect((await request(path, fixture.reader, { expectedRevision: 1, description }, 'PATCH')).status).toBe(403);
  expect((await request(path, fixture.owner, { expectedRevision: 1, description: { type: 'script' } }, 'PATCH')).status).toBe(400);
  expect((await fixture.patchTeamspace(tree.teamspace, { name: 'Renamed from the directory' })).status).toBe(200);
  expect((await request(path, fixture.owner, { expectedRevision: 1, name: 'Stale overview rename' }, 'PATCH')).status).toBe(409);
});

test('a manager downgraded while waiting for the knowledge-base lock cannot save folder metadata', async () => {
  const tree = await fixture.tree({ defaultAccess: 'view' }); await fixture.drain();
  await fixture.admin.query("UPDATE resources.knowledge_base_member SET role='admin' WHERE knowledge_base_id=$1 AND user_id=$2", [fixture.alpha.id, fixture.reader.identity.userId]);
  const client = await fixture.admin.connect(); let response: Promise<Response> | undefined;
  try {
    await client.query('BEGIN'); await client.query('SELECT id FROM resources.knowledge_base WHERE id=$1 FOR UPDATE', [fixture.alpha.id]);
    response = request(`folders/${tree.teamspace.id}`, fixture.reader, { expectedRevision: 0, name: 'Stale manager' }, 'PATCH');
    await fixture.waitForKnowledgeBaseLock(client);
    await client.query("UPDATE resources.knowledge_base_member SET role='member' WHERE knowledge_base_id=$1 AND user_id=$2", [fixture.alpha.id, fixture.reader.identity.userId]);
    await client.query('COMMIT'); expect((await response).status).toBe(403);
    const saved = folderOverviewSchema.parse(await (await request(`folders/${tree.teamspace.id}`)).json()); expect(saved.folder.name).toBe(tree.teamspace.name);
  } finally { await client.query('ROLLBACK'); if (response) await response; client.release(); await fixture.admin.query("UPDATE resources.knowledge_base_member SET role='member' WHERE knowledge_base_id=$1 AND user_id=$2", [fixture.alpha.id, fixture.reader.identity.userId]); }
});

test('session expiry while waiting for a folder write is rechecked under the resource lock', async () => {
  const tree = await fixture.tree({ defaultAccess: 'view' }); await fixture.drain();
  const previous = await fixture.admin.query('SELECT expires_at FROM auth.session WHERE id=$1', [fixture.owner.identity.sessionId]);
  const client = await fixture.admin.connect(); let response: Promise<Response> | undefined;
  try {
    await client.query('BEGIN'); await client.query('SELECT id FROM resources.knowledge_base WHERE id=$1 FOR UPDATE', [fixture.alpha.id]);
    response = request(`folders/${tree.teamspace.id}`, fixture.owner, { expectedRevision: 0, name: 'Expired writer' }, 'PATCH');
    await fixture.waitForKnowledgeBaseLock(client);
    // Set the deadline after HTTP authentication, which may renew a near-expiry session.
    await client.query("UPDATE auth.session SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [fixture.owner.identity.sessionId]); await client.query('COMMIT');
    expect((await response).status).toBe(401);
  } finally { await client.query('ROLLBACK'); if (response) await response; await client.query('UPDATE auth.session SET expires_at=$2 WHERE id=$1', [fixture.owner.identity.sessionId, previous.rows[0]!.expires_at]); client.release(); }
  const saved = folderOverviewSchema.parse(await (await request(`folders/${tree.teamspace.id}`)).json()); expect(saved.folder.name).toBe(tree.teamspace.name);
});

test('personal tokens need read/write scope and live management authority for overview mutations', async () => {
  const tree = await fixture.tree({ defaultAccess: 'view' }); await fixture.drain();
  const path = `${fixture.server.origin}/api/knowledge/${fixture.alpha.id}/discovery/folders/${tree.teamspace.id}`;
  const write = (authorization: string) => fetch(path, { method: 'PATCH', headers: { origin: fixture.server.webOrigin, authorization, 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, name: 'Token overview' }) });
  expect((await write(await fixture.createToken(fixture.owner, ['read']))).status).toBe(403);
  expect((await write(await fixture.createToken(fixture.reader, ['read', 'write']))).status).toBe(403);
  expect((await write(await fixture.createToken(fixture.owner, ['read', 'write']))).status).toBe(200);
});
test('search, facets, counts and overview keep unreadable, recycled and foreign content out', async () => {
  const hidden = await fixture.tree({ defaultAccess: null }), visible = await fixture.tree({ defaultAccess: 'view', recycled: [3] }); await fixture.drain();
  await seed(hidden.root, 'Secret Discovery', 'classified discovery'); await seed(visible.pages[0], 'Public Discovery', 'public discovery');
  const result = discoverySearchResultSchema.parse(await (await request('search', fixture.reader, { query: 'Discovery' })).json());
  expect(result.documents.some(document => document.id === hidden.root.pageId)).toBe(false);
  const folder = folderOverviewSchema.parse(await (await request(`folders/${visible.teamspace.id}`, fixture.reader)).json()); expect(folder.total).toBe(3);
  expect((await request(`folders/${hidden.teamspace.id}`, fixture.reader)).status).toBe(403);
  expect((await request(`folders/${visible.teamspace.id}`, fixture.foreign)).status).toBe(401);
  const facets = discoveryFacetsSchema.parse(await (await request('facets', fixture.reader)).json()); expect(facets.authors.some(author => author.id === fixture.foreign.identity.userId)).toBe(false);
  expect((await request('search', fixture.owner, { query: 'anything', folderId: 'invalid' })).status).toBe(400);
});

test('revoked pinned documents do not leak their identifiers through folder metadata', async () => {
  const tree = await fixture.tree({ defaultAccess: 'view', parents: [null, 0], breaks: [1] }); await fixture.drain();
  await fixture.admin.query('UPDATE resources.teamspace SET metadata=$3 WHERE knowledge_base_id=$1 AND id=$2', [fixture.alpha.id, tree.teamspace.id, JSON.stringify({ pinnedPageIds: [tree.root.pageId, tree.pages[1]!.pageId] })]);
  const overview = folderOverviewSchema.parse(await (await request(`folders/${tree.teamspace.id}`, fixture.reader)).json());
  expect(overview.total).toBe(1); expect(overview.pinned.map(document => document.id)).toEqual([tree.root.pageId]);
  expect(overview.folder.metadata.pinnedPageIds).toEqual([tree.root.pageId]);
});
