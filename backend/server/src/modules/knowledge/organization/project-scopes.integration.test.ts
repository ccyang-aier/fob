import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createProjectService } from '../../projects/service';
import { createPermissionsFixture, type PermissionsFixture, type PermissionTestActor } from '../permissions/permissions-test-fixture';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture(); }, 30_000);
afterAll(async () => { await fixture?.close(); }, 30_000);

function request(actor: PermissionTestActor, path = '', method: 'GET' | 'PATCH' = 'GET', body?: unknown) {
  return fetch(`${fixture.server.origin}/api/knowledge-bases${path}`, {
    method, headers: { cookie: actor.cookie, origin: fixture.server.webOrigin, ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

test('project directory returns only associated libraries with an existing library membership', async () => {
  const { owner, foreign, organization } = fixture;
  const projects = createProjectService(fixture.pool);
  const first = await projects.create(owner.identity, { name: 'First' });
  const second = await projects.create(owner.identity, { name: 'Second' });
  const library = await organization.createKnowledgeBase(owner.identity, { name: 'First library', projectIds: [first.id] });
  await organization.createKnowledgeBase(owner.identity, { name: 'Unassociated library' });
  expect((await organization.listKnowledgeBases(owner.identity, { projectId: first.id })).items).toEqual([library]);
  expect((await organization.listKnowledgeBases(owner.identity, { projectId: second.id })).items).toEqual([]);
  await expect(organization.listKnowledgeBases(foreign.identity, { projectId: first.id })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  await fixture.admin.query("INSERT INTO resources.project_member(project_id,user_id,role) VALUES ($1,$2,'member')", [first.id, foreign.identity.userId]);
  expect((await organization.listKnowledgeBases(foreign.identity, { projectId: first.id })).items).toEqual([]);
  expect((await request(owner, `?projectId=${first.id}`)).status).toBe(200);
  expect((await (await request(owner, `?projectId=${first.id}`)).json() as { items: unknown[] }).items).toEqual([library]);
  expect((await request(foreign, `?projectId=${second.id}`)).status).toBe(404);
});

test('only library owners configure project scope and unavailable project changes are atomic', async () => {
  const { organization, owner, reader, foreign, alpha } = fixture;
  const projects = createProjectService(fixture.pool);
  const ownProject = await projects.create(owner.identity, { name: 'Owned scope' });
  const foreignProject = await projects.create(foreign.identity, { name: 'Foreign scope' });
  const path = `/${alpha.id}/projects`;
  expect((await request(owner, path, 'PATCH', { projectIds: [ownProject.id] })).status).toBe(200);
  expect(await (await request(owner, path)).json()).toEqual({ knowledgeBaseId: alpha.id, projectIds: [ownProject.id] });
  expect((await request(reader, path, 'PATCH', { projectIds: [] })).status).toBe(403);
  await fixture.admin.query("UPDATE resources.knowledge_base_member SET role='admin' WHERE knowledge_base_id=$1 AND user_id=$2", [alpha.id, reader.identity.userId]);
  expect((await request(reader, path)).status).toBe(403);
  expect((await request(reader, path, 'PATCH', { projectIds: [] })).status).toBe(403);
  await fixture.admin.query("UPDATE resources.knowledge_base_member SET role='member' WHERE knowledge_base_id=$1 AND user_id=$2", [alpha.id, reader.identity.userId]);
  expect((await request(owner, path, 'PATCH', { projectIds: [ownProject.id, foreignProject.id] })).status).toBe(404);
  expect(await organization.getKnowledgeBaseProjects(owner.identity, { knowledgeBaseId: alpha.id })).toEqual({ knowledgeBaseId: alpha.id, projectIds: [ownProject.id] });
  expect((await request(owner, path, 'PATCH', { projectIds: [ownProject.id], knowledgeBaseId: alpha.id })).status).toBe(400);
  await expect(organization.createKnowledgeBase(owner.identity, { name: 'Rejected scope', projectIds: [randomUUID()] })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  expect((await organization.listKnowledgeBases(owner.identity, {})).items.some((item) => item.name === 'Rejected scope')).toBe(false);
  expect((await request(owner, path, 'PATCH', { projectIds: [] })).status).toBe(200);
  expect((await organization.listKnowledgeBases(owner.identity, { projectId: ownProject.id })).items).toEqual([]);
});

test('a project association preserves page ACL and project membership revocation fails closed', async () => {
  const { owner, reader, organization, alpha } = fixture;
  const project = await createProjectService(fixture.pool).create(owner.identity, { name: 'Page scope' });
  await fixture.admin.query("INSERT INTO resources.project_member(project_id,user_id,role) VALUES ($1,$2,'member')", [project.id, reader.identity.userId]);
  await organization.updateKnowledgeBaseProjects(owner.identity, { knowledgeBaseId: alpha.id, projectIds: [project.id] });
  expect((await organization.listKnowledgeBases(reader.identity, { projectId: project.id })).items).toContainEqual(alpha);
  const { pages } = await fixture.tree({ defaultAccess: null });
  await fixture.drain();
  expect(await fixture.apiClient({ cookie: reader.cookie }).page.access.query({ knowledgeBaseId: alpha.id, pageId: pages[0]!.pageId, action: 'view' })).toMatchObject({ authorized: false, level: null });
  await fixture.admin.query('DELETE FROM resources.project_member WHERE project_id=$1 AND user_id=$2', [project.id, reader.identity.userId]);
  await expect(organization.listKnowledgeBases(reader.identity, { projectId: project.id })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
});
