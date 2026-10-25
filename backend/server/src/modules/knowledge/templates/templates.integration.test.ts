import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import type { JSONContent } from '@tiptap/core';
import type { KnowledgeTemplateListResult, KnowledgeTemplateSummary } from '@fob/shared/knowledge/templates';
import { knowledgeTemplateDetailSchema, knowledgeTemplateListResultSchema } from '@fob/shared/knowledge/templates';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { principal } from '@fob/shared/knowledge/contracts';
import { createPermissionsFixture, type PermissionsFixture, type PermissionTestActor } from '../permissions/permissions-test-fixture';
import { replaceAuthorizedPageAcl, setAuthorizedPageInheritance } from '../permissions/mutations';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { prosemirrorDocToYDoc, yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { createKnowledgeTemplateRoutes } from './http';

let fixture: PermissionsFixture;
beforeAll(async () => {
  fixture = await createPermissionsFixture({ mount(app, context) { app.route('/', createKnowledgeTemplateRoutes({ ...context, trustedOrigins: context.auth.options.trustedOrigins as string[] })); } });
}, 30_000);
afterAll(async () => { await fixture?.close(); }, 30_000);
beforeEach(async () => { await fixture.resetJobs(); await fixture.admin.query('DELETE FROM resources.knowledge_template'); });
const textDocument = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'source_block' }, content: [{ type: 'text', text }] }] });
function request(path: string, actor: PermissionTestActor, method = 'GET', body?: unknown, knowledgeBaseId = fixture.alpha.id) {
  return fetch(`${fixture.server.origin}/api/knowledge/${knowledgeBaseId}/templates${path}`, { method, headers: { cookie: actor.cookie, origin: fixture.server.webOrigin,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function source() {
  const tree = await fixture.tree({ defaultAccess: 'edit', parents: [null] });
  await fixture.drain();
  const encoded = prosemirrorDocToYDoc(knowledgeSchema.nodeFromJSON(textDocument('Stored earlier')));
  try { await fixture.admin.query('INSERT INTO resources.doc_state (knowledge_base_id,page_id,state,state_vector) VALUES ($1,$2,$3,$4)', [tree.root.knowledgeBaseId, tree.root.pageId, Buffer.from(encoded.state), Buffer.from(encoded.stateVector)]); }
  finally { encoded.ydoc.destroy(); }
  return tree;
}
async function save(pageId: string, name = 'Project template', document?: JSONContent) {
  const response = await request('', fixture.owner, 'POST', { sourcePageId: pageId, name, description: 'A reusable article', ...(document ? { document } : {}) });
  expect(response.status).toBe(201);
  return response.json() as Promise<KnowledgeTemplateSummary>;
}
async function detail(id: string, actor = fixture.owner) {
  const response = await request(`/${id}`, actor);
  expect(response.status).toBe(200);
  return knowledgeTemplateDetailSchema.parse(await response.json());
}

test('real template save, search, preview and metadata management snapshot the immediate editor body', async () => {
  const tree = await source();
  const template = await save(tree.root.pageId, 'Roadmap 100%', textDocument('Latest editor text before debounce'));
  const preview = await detail(template.id);
  expect(knowledgeSchema.nodeFromJSON(preview.document).textContent).toBe('Latest editor text before debounce');
  expect(preview.document.content![0]!.attrs!.blockId).not.toBe('source_block');
  expect(template).toMatchObject({ sourcePageId: tree.root.pageId, createdBy: fixture.owner.identity.userId, canManage: true });
  const search = knowledgeTemplateListResultSchema.parse(await (await request('?q=100%25', fixture.reader)).json());
  expect(search.items.map((item) => item.id)).toEqual([template.id]);
  expect(search.items[0]!.canManage).toBe(false);
  expect((await request(`/${template.id}`, fixture.reader, 'PATCH', { name: 'Stolen management' })).status).toBe(403);
  expect((await request(`/${template.id}`, fixture.reader, 'DELETE', {})).status).toBe(403);
  const changed = await request(`/${template.id}`, fixture.owner, 'PATCH', { name: 'Release plan', description: 'Revised description' });
  expect(changed.status).toBe(200);
  expect(await changed.json()).toMatchObject({ name: 'Release plan', description: 'Revised description' });
  expect((await request(`/${template.id}`, fixture.foreign)).status).toBe(401);
  expect((await request('', fixture.owner, 'POST', { sourcePageId: tree.root.pageId, name: 'Spoof', userId: fixture.reader.identity.userId })).status).toBe(400);
});

test('applying twice creates distinct documents and independent Yjs identities without changing the snapshot', async () => {
  const tree = await source();
  const template = await save(tree.root.pageId);
  const created: string[] = [];
  for (let index = 0; index < 2; index++) {
    const id = randomUUID();
    const response = await request(`/${template.id}/pages`, fixture.reader, 'POST', { id, teamspaceId: tree.teamspace.id, title: `Copy ${index}` });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ pageId: id });
    created.push(id);
  }
  const rows = await fixture.admin.query<{ page_id: string; state: Buffer; state_vector: Buffer }>('SELECT page_id,state,state_vector FROM resources.doc_state WHERE knowledge_base_id=$1 AND page_id=ANY($2::uuid[]) ORDER BY page_id', [fixture.alpha.id, created]);
  expect(rows.rows).toHaveLength(2);
  const first = yStateToProseMirrorDoc(new Uint8Array(rows.rows[0]!.state), knowledgeSchema)!;
  const second = yStateToProseMirrorDoc(new Uint8Array(rows.rows[1]!.state), knowledgeSchema)!;
  expect(first.textContent).toBe('Stored earlier');
  expect(second.textContent).toBe('Stored earlier');
  expect(first.firstChild!.attrs.blockId).not.toBe(second.firstChild!.attrs.blockId);
  expect(rows.rows[0]!.state_vector.equals(rows.rows[1]!.state_vector)).toBe(false);
  const updated = prosemirrorDocToYDoc(knowledgeSchema.nodeFromJSON(textDocument('Only copy one changes')));
  try { await fixture.admin.query('UPDATE resources.doc_state SET state=$3,state_vector=$4 WHERE knowledge_base_id=$1 AND page_id=$2', [fixture.alpha.id, rows.rows[0]!.page_id, Buffer.from(updated.state), Buffer.from(updated.stateVector)]); }
  finally { updated.ydoc.destroy(); }
  expect(knowledgeSchema.nodeFromJSON((await detail(template.id)).document).textContent).toBe('Stored earlier');
  const remaining = await fixture.admin.query<{ state: Buffer }>('SELECT state FROM resources.doc_state WHERE knowledge_base_id=$1 AND page_id=$2', [fixture.alpha.id, rows.rows[1]!.page_id]);
  expect(yStateToProseMirrorDoc(new Uint8Array(remaining.rows[0]!.state), knowledgeSchema)!.textContent).toBe('Stored earlier');
  expect((await request(`/${template.id}/pages`, fixture.owner, 'POST', { id: randomUUID(), teamspaceId: fixture.beta.id })).status).toBe(404);
});

test('live source ACL and destination authority prevent template bypass after revocation or recycling', async () => {
  const tree = await source();
  const template = await save(tree.root.pageId);
  const restricted = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, name: 'Restricted destination', defaultAccess: 'view' });
  expect((await request(`/${template.id}/pages`, fixture.reader, 'POST', { id: randomUUID(), teamspaceId: restricted.id })).status).toBe(403);
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, async (db) => {
    await setAuthorizedPageInheritance(db, { ...tree.root, inheritsPermissions: false });
    await replaceAuthorizedPageAcl(db, { ...tree.root, grants: [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }] });
  });
  await fixture.drain();
  const hidden = await request('', fixture.reader);
  expect((await hidden.json() as KnowledgeTemplateListResult).items).toEqual([]);
  expect((await request(`/${template.id}`, fixture.reader)).status).toBe(404);
  expect((await request(`/${template.id}/pages`, fixture.reader, 'POST', { id: randomUUID(), teamspaceId: tree.teamspace.id })).status).toBe(404);
  await fixture.apiClient({ cookie: fixture.owner.cookie, origin: fixture.server.webOrigin }).page.recycle.mutate(tree.root);
  expect((await request(`/${template.id}`, fixture.owner)).status).toBe(404);
});

test('template attachments stay in their library and revoked assets cannot be materialized', async () => {
  const tree = await source();
  const hash = 'c'.repeat(64);
  const foreignHash = 'd'.repeat(64);
  await fixture.admin.query("INSERT INTO resources.asset (knowledge_base_id,hash,mime,size) VALUES ($1,$2,'image/png',4),($3,$4,'image/png',4)", [fixture.alpha.id, hash, fixture.beta.id, foreignHash]);
  const imageDocument = (value: string): JSONContent => ({ type: 'doc', content: [{ type: 'image', attrs: { src: `asset:${value}`, alt: 'Same library image' } }] });
  expect((await request('', fixture.owner, 'POST', { sourcePageId: tree.root.pageId, name: 'Cross library attachment', document: imageDocument(foreignHash) })).status).toBe(409);
  const template = await save(tree.root.pageId, 'Image template', imageDocument(hash));
  const preview = await detail(template.id);
  expect(JSON.stringify(preview.document)).toContain(`asset:${hash}`);
  await fixture.admin.query("UPDATE resources.asset SET status='revoked' WHERE knowledge_base_id=$1 AND hash=$2", [fixture.alpha.id, hash]);
  expect((await request(`/${template.id}/pages`, fixture.reader, 'POST', { id: randomUUID(), teamspaceId: tree.teamspace.id })).status).toBe(409);
  expect((await request(`/${template.id}`, fixture.owner, 'DELETE', {})).status).toBe(200);
  expect((await request(`/${template.id}`, fixture.owner)).status).toBe(404);
});

test('invalid editor JSON, file pages and read-only credentials cannot publish a template', async () => {
  const tree = await source();
  expect((await request('', fixture.owner, 'POST', { sourcePageId: tree.root.pageId, name: 'Invalid', document: { type: 'doc', content: [{ type: 'unknown' }] } })).status).toBe(400);
  const authorization = await fixture.createToken(fixture.owner, ['read']);
  const denied = await fetch(`${fixture.server.origin}/api/knowledge/${fixture.alpha.id}/templates`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ sourcePageId: tree.root.pageId, name: 'No write scope' }) });
  expect(denied.status).toBe(403);
  await fixture.admin.query('UPDATE resources.page SET properties=$3 WHERE knowledge_base_id=$1 AND id=$2', [fixture.alpha.id, tree.root.pageId, JSON.stringify({ fileAsset: `asset:${'a'.repeat(64)}`, fileName: 'document.pdf' })]);
  expect((await request('', fixture.owner, 'POST', { sourcePageId: tree.root.pageId, name: 'File is not article' })).status).toBe(400);
  expect((await fixture.admin.query('SELECT count(*)::int AS count FROM resources.knowledge_template')).rows).toEqual([{ count: 0 }]);
});
