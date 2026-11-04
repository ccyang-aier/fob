import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { localKnowledgeBaseImportSchema, type LocalKnowledgeBaseImport } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { createPermissionsFixture, type PermissionsFixture, type PermissionTestActor } from '../permissions/permissions-test-fixture';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture(); }, 60_000);
afterAll(async () => { await fixture?.close(); }, 30_000);

function snapshot(): LocalKnowledgeBaseImport {
  const folder = randomUUID(), child = randomUUID(), page = randomUUID(), deleted = randomUUID(), template = randomUUID();
  const now = new Date().toISOString(), body = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'preserved-block' }, content: [{ type: 'text', text: '完整保留的正文' }] }] };
  return localKnowledgeBaseImportSchema.parse({ sourceKnowledgeBaseId: randomUUID(),
    folders: [{ id: child, name: '子文件夹', parentId: folder, metadata: { icon: '📚' } }, { id: folder, name: '研究', metadata: { pinnedPageIds: [page] } }],
    documents: [{ id: page, folderId: child, title: '本机知识', icon: '📝', body, deleted: false, updatedAt: now, readCount: 4 }, { id: deleted, folderId: folder, title: '已回收', body, deleted: true, updatedAt: now }],
    templates: [{ template: { id: template, sourcePageId: page, name: '我的模板', description: '', title: '本机知识', icon: '📝', createdAt: now, updatedAt: now }, document: body }],
  });
}
async function target() { return fixture.organization.createKnowledgeBase(fixture.owner.identity, { name: 'Conversion acceptance' }); }
async function request(id: string, manifest: unknown, actor: PermissionTestActor = fixture.owner) {
  const form = new FormData(); form.set('manifest', JSON.stringify(manifest));
  return fetch(`${fixture.server.origin}/api/knowledge-bases/${id}/import-local`, { method: 'POST', headers: { origin: fixture.server.webOrigin, cookie: actor.cookie }, body: form });
}

test('explicit conversion preserves hierarchy, native Yjs body, trash, template and readership', async () => {
  const base = await target(), input = snapshot();
  const response = await request(base.id, input);
  expect(response.status).toBe(200);
  expect((await response.json() as { imported: unknown }).imported).toEqual({ folders: 2, documents: 2, templates: 1 });
  const folders = await fixture.admin.query('select id, parent_id, metadata from resources.teamspace where knowledge_base_id=$1', [base.id]);
  expect(folders.rows).toHaveLength(2);
  expect(folders.rows.find(row => row.id === input.folders[0]!.id).parent_id).toBe(input.folders[1]!.id);
  const bodies = await fixture.admin.query('select page_id,state from resources.doc_state where knowledge_base_id=$1', [base.id]);
  expect(bodies.rows).toHaveLength(2);
  expect(yStateToProseMirrorDoc(bodies.rows[0].state, knowledgeSchema)?.textContent).toBe('完整保留的正文');
  const pages = await fixture.admin.query('select id,deleted_at,created_by from resources.page where knowledge_base_id=$1', [base.id]);
  expect(pages.rows.find(row => row.id === input.documents[1]!.id).deleted_at).not.toBeNull();
  expect(pages.rows.every(row => row.created_by === fixture.owner.identity.userId)).toBe(true);
  expect((await fixture.admin.query('select count(*)::int as count from resources.knowledge_template where knowledge_base_id=$1', [base.id])).rows[0].count).toBe(1);
  expect((await fixture.admin.query('select views from resources.document_visit where knowledge_base_id=$1', [base.id])).rows[0].views).toBe(4);
  expect((await request(base.id, input)).status).toBe(409);
}, 30_000);

test('conversion cannot write into another knowledge base or bypass owner authority', async () => {
  const base = await target(), input = snapshot();
  expect((await request(base.id, input, fixture.foreign)).status).toBe(404);
  expect((await request(fixture.alpha.id, input, fixture.reader)).status).toBe(403);
  expect((await fixture.admin.query('select count(*)::int as count from resources.page where knowledge_base_id=$1', [base.id])).rows[0].count).toBe(0);
});

test('missing attachments, invalid bodies and cyclic folders leave the destination empty', async () => {
  for (const kind of ['asset', 'body', 'cycle']) {
    const base = await target(), input = snapshot();
    if (kind === 'asset') input.documents[0]!.file = { source: `asset:${'a'.repeat(64)}`, name: 'missing.txt', mime: 'text/plain', size: 5 };
    if (kind === 'body') input.documents[1]!.body = { type: 'doc', content: [{ type: 'unknown-node' }] };
    if (kind === 'cycle') input.folders[1]!.parentId = input.folders[0]!.id;
    expect((await request(base.id, input)).status).toBe(400);
    expect((await fixture.admin.query('select count(*)::int as count from resources.page where knowledge_base_id=$1', [base.id])).rows[0].count).toBe(0);
    expect((await fixture.admin.query('select count(*)::int as count from resources.teamspace where knowledge_base_id=$1', [base.id])).rows[0].count).toBe(1);
  }
}, 30_000);

test('the explicit manifest route accepts native document bodies above the ordinary JSON request limit', async () => {
  const base = await target(), input = snapshot();
  input.documents[0]!.body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a'.repeat(140_000) }] }] };
  expect((await request(base.id, input)).status).toBe(200);
}, 30_000);
