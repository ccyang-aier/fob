import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import type { PermissionTestActor } from '../permissions/permissions-test-fixture';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture(); }, 30_000);
afterAll(async () => { await fixture?.close(); }, 30_000);

function request(path: string, actor: PermissionTestActor, method = 'GET', body?: unknown) {
  return fetch(`${fixture.server.origin}/api/knowledge-bases${path}`, { method, headers: {
    origin: fixture.server.webOrigin, cookie: actor.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test('multiple independent libraries each create their own default folder and owner', async () => {
  const { organization, owner, foreign } = fixture;
  const first = await organization.createKnowledgeBase(owner.identity, { name: '资料库' });
  const second = await organization.createKnowledgeBase(owner.identity, { name: '设计库' });
  expect(first.id).not.toBe(second.id);
  expect(first).not.toHaveProperty('knowledgeBaseId');
  const owned = await organization.listKnowledgeBases(owner.identity, {});
  expect(owned.items).toContainEqual(first);
  expect(owned.items).toContainEqual(second);
  expect((await organization.listKnowledgeBases(foreign.identity, {})).items.some((item) => item.id === first.id)).toBe(false);
  const folders = await organization.listTeamspaces(owner.identity, { knowledgeBaseId: first.id });
  expect(folders.items).toHaveLength(1);
  expect(folders.items[0]).toMatchObject({ knowledgeBaseId: first.id, name: '文档' });
  const secondFolders = await organization.listTeamspaces(owner.identity, { knowledgeBaseId: second.id });
  expect(secondFolders.items[0]!.id).not.toBe(folders.items[0]!.id);
});

test('library membership governs folders while any verified user may create a library', async () => {
  const { organization, owner, beta, reader } = fixture;
  await expect(organization.createTeamspace(owner.identity, { knowledgeBaseId: beta.id, name: '无授权' })).rejects.toMatchObject({ code: 'KNOWLEDGE_BASE_NOT_FOUND' });
  await expect(organization.createTeamspace(owner.identity, { knowledgeBaseId: randomUUID(), name: '缺失' })).rejects.toMatchObject({ code: 'KNOWLEDGE_BASE_NOT_FOUND' });
  await expect(organization.createTeamspace(owner.identity, { name: '无归属' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const created = await organization.createKnowledgeBase(reader.identity, { name: '我的资料' });
  expect((await organization.getKnowledgeBase(reader.identity, { knowledgeBaseId: created.id })).role).toBe('owner');
  await expect(organization.createKnowledgeBase(owner.identity, { name: '无效范围', knowledgeBaseId: beta.id })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('REST catalog lists authorized libraries and uses each real library ID for folder routes', async () => {
  const { server, owner, foreign } = fixture;
  const headers = { cookie: owner.cookie, origin: server.webOrigin, 'content-type': 'application/json' };
  const created = await fetch(`${server.origin}/api/knowledge-bases`, { method: 'POST', headers, body: JSON.stringify({ name: 'HTTP 资料库' }) });
  expect(created.status).toBe(201);
  const base = await created.json() as { id: string };
  const response = await fetch(`${server.origin}/api/knowledge-bases/${base.id}/teamspaces`, { headers });
  expect(response.status).toBe(200);
  const folders = await response.json() as { items: { knowledgeBaseId: string }[] };
  expect(folders.items).toHaveLength(1);
  expect(folders.items.every((folder) => folder.knowledgeBaseId === base.id)).toBe(true);
  expect((await fetch(`${server.origin}/api/knowledge-bases/${base.id}/teamspaces`, { headers: { origin: server.webOrigin, cookie: foreign.cookie } })).status).toBe(404);
  expect((await fetch(`${server.origin}/api/knowledge-bases`, { headers: { origin: server.webOrigin } })).status).toBe(401);
});

test('catalog accepts direct knowledge-base scope and rejects removed project inputs and association routes', async () => {
  const { owner, alpha } = fixture;
  const response = await request('', owner);
  expect(response.status).toBe(200);
  const catalog = await response.json() as { items: { id: string; name: string }[] };
  expect(catalog.items.some((item) => item.id === alpha.id)).toBe(true);
  expect((await request(`?projectId=${randomUUID()}`, owner)).status).toBe(400);
  expect((await request('', owner, 'POST', { name: 'Injected', projectIds: [randomUUID()] })).status).toBe(400);
  expect((await request('', owner, 'POST', { name: 'Injected', projectId: randomUUID() })).status).toBe(400);
  expect((await request(`/${alpha.id}/projects`, owner)).status).toBe(404);
  expect((await request(`/${alpha.id}/projects`, owner, 'PATCH', { projectIds: [] })).status).toBe(404);
});

test('only owners may rename or delete a knowledge base; admin membership grants no owner shortcut', async () => {
  const { organization, owner, reader, foreign } = fixture;
  const base = await organization.createKnowledgeBase(owner.identity, { name: 'Owner management' });
  const invitation = await organization.createInvitation(owner.identity, { knowledgeBaseId: base.id, email: reader.identity.email, role: 'admin' });
  await organization.acceptInvitation(reader.identity, { knowledgeBaseId: base.id, invitationId: invitation.invitation.id, token: invitation.token });
  expect((await request(`/${base.id}`, reader, 'PATCH', { name: 'Admin renamed' })).status).toBe(403);
  expect((await request(`/${base.id}`, reader, 'DELETE', {})).status).toBe(403);
  expect((await request(`/${base.id}`, foreign, 'PATCH', { name: 'Foreign renamed' })).status).toBe(404);
  expect((await request(`/${base.id}`, foreign, 'DELETE', {})).status).toBe(404);
  const renamed = await request(`/${base.id}`, owner, 'PATCH', { name: 'Owner renamed' });
  expect(renamed.status).toBe(200);
  expect(await renamed.json()).toEqual({ id: base.id, name: 'Owner renamed', role: 'owner' });
  expect((await request(`/${base.id}`, owner, 'DELETE', { knowledgeBaseId: base.id })).status).toBe(400);
  const removed = await request(`/${base.id}`, owner, 'DELETE', {});
  expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ removed: true });
  expect((await request(`/${base.id}`, owner)).status).toBe(404);
});

test('revoking direct library membership removes discovery and page access without changing other libraries', async () => {
  const { owner, reader, foreign, organization, alpha, beta } = fixture;
  const tree = await fixture.tree({ parents: [null], defaultAccess: 'view' });
  await fixture.drain();
  expect((await organization.listKnowledgeBases(reader.identity)).items.some((item) => item.id === alpha.id)).toBe(true);
  const client = fixture.apiClient({ cookie: reader.cookie, origin: fixture.server.webOrigin });
  expect(await client.page.access.query({ ...tree.root, action: 'view' })).toMatchObject({ authorized: true });
  await organization.removeMember(owner.identity, { knowledgeBaseId: alpha.id, userId: reader.identity.userId });
  expect((await organization.listKnowledgeBases(reader.identity)).items.some((item) => item.id === alpha.id)).toBe(false);
  expect((await request(`/${alpha.id}`, reader)).status).toBe(404);
  await expect(client.page.access.query({ ...tree.root, action: 'view' })).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  expect((await organization.getKnowledgeBase(foreign.identity, { knowledgeBaseId: beta.id })).role).toBe('owner');
  expect((await request(`/${beta.id}`, owner, 'DELETE', {})).status).toBe(404);
});

test('owner deletion removes the entire library tree and content while retaining other libraries and accounts', async () => {
  const { owner, foreign, alpha, beta, admin } = fixture;
  const tree = await fixture.tree({ parents: [null, 0, 1] });
  await admin.query('INSERT INTO resources.doc_state (knowledge_base_id,page_id,state,state_vector) VALUES ($1,$2,$3,$4)', [alpha.id, tree.root.pageId, Buffer.from([0]), Buffer.from([0])]);
  const before = await admin.query<{ users: number; beta_pages: number }>('SELECT (SELECT count(*)::int FROM auth."user") AS users, (SELECT count(*)::int FROM resources.page WHERE knowledge_base_id=$1) AS beta_pages', [beta.id]);
  expect((await request(`/${alpha.id}`, owner, 'DELETE', {})).status).toBe(200);
  for (const table of ['knowledge_base_member', 'teamspace', 'page', 'doc_state', 'block_index', 'page_effective_acl']) {
    expect((await admin.query(`SELECT count(*)::int AS count FROM resources.${table} WHERE knowledge_base_id=$1`, [alpha.id])).rows).toEqual([{ count: 0 }]);
  }
  const after = await admin.query<{ users: number; beta_pages: number }>('SELECT (SELECT count(*)::int FROM auth."user") AS users, (SELECT count(*)::int FROM resources.page WHERE knowledge_base_id=$1) AS beta_pages', [beta.id]);
  expect(after.rows).toEqual(before.rows);
  expect((await request(`/${beta.id}`, foreign)).status).toBe(200);
  expect((await request(`/${alpha.id}`, owner, 'DELETE', {})).status).toBe(404);
});
