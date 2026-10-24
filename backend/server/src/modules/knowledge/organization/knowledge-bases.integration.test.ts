import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture(); }, 30_000);
afterAll(async () => { await fixture?.close(); }, 30_000);

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
