import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createAuthTestServer, responseCookie, testPassword } from '../../platform/identity/auth-test-server';
import type { AuthTestServer } from '../../platform/identity/auth-test-server';
import { createProjectRoutes } from './http';
import { createProjectService } from './service';

let server: AuthTestServer;
let owner: { cookie: string; userId: string };
let outsider: { cookie: string; userId: string };

async function actor(name: string) {
  const email = `${name}@projects.test`;
  expect((await server.request('/sign-up/email', { email, name, password: testPassword })).status).toBe(200);
  expect((await server.request(server.verificationPath(email))).status).toBe(302);
  const cookie = responseCookie(await server.request('/sign-in/email', { email, password: testPassword }));
  const identity = await (await fetch(`${server.origin}/test/identity`, { headers: { cookie } })).json() as { userId: string };
  return { cookie, userId: identity.userId };
}

function request(actor: { cookie: string }, path = '', method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', body?: unknown) {
  return fetch(`${server.origin}/api/projects${path}`, {
    method, headers: { origin: server.webOrigin, cookie: actor.cookie, ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
}

beforeAll(async () => {
  server = await createAuthTestServer({ mount(app, { auth, database }) {
    app.route('/', createProjectRoutes(auth, createProjectService(database.pool)));
  } });
  owner = await actor('owner');
  outsider = await actor('outsider');
}, 30_000);
afterAll(async () => { await server?.close(); }, 30_000);

test('projects are independent roots and only their members can list or mutate them', async () => {
  const created = await request(owner, '', 'POST', { name: 'Project A' });
  expect(created.status).toBe(201);
  const project = await created.json() as { id: string; name: string };
  expect(Object.keys(project).sort()).toEqual(['id', 'name']);
  expect((await (await request(owner)).json() as { items: unknown[] }).items).toContainEqual(project);
  expect((await (await request(outsider)).json() as { items: unknown[] }).items).toEqual([]);
  expect((await request(outsider, `/${project.id}`, 'PATCH', { name: 'Unauthorized' })).status).toBe(404);
  expect((await request(outsider, `/${project.id}`, 'DELETE')).status).toBe(404);
  expect((await request(owner, `/${project.id}`, 'PATCH', { name: 'Renamed' })).status).toBe(200);
  expect((await request(owner, `/${project.id}`, 'PATCH', { name: 'Injected', projectId: project.id })).status).toBe(400);
  expect((await request(owner, `/${project.id}`, 'DELETE')).status).toBe(200);
  expect((await (await request(owner)).json() as { items: unknown[] }).items).toEqual([]);
  expect((await request(outsider, '', 'POST', { name: 'My project' })).status).toBe(201);
  expect((await (await request(owner)).json() as { items: unknown[] }).items).toEqual([]);
});

test('project role limits remain independent of other resource memberships', async () => {
  const response = await request(owner, '', 'POST', { name: 'Shared project' });
  expect(response.status).toBe(201);
  const project = await response.json() as { id: string; name: string };
  await server.database.admin.query("INSERT INTO resources.project_member(project_id,user_id,role) VALUES ($1,$2,'member')", [project.id, outsider.userId]);
  expect((await (await request(outsider)).json() as { items: { id: string }[] }).items.some((item) => item.id === project.id)).toBe(true);
  expect((await request(outsider, `/${project.id}`, 'PATCH', { name: 'Denied member' })).status).toBe(403);
  await server.database.admin.query("UPDATE resources.project_member SET role='admin' WHERE project_id=$1 AND user_id=$2", [project.id, outsider.userId]);
  expect((await request(outsider, `/${project.id}`, 'PATCH', { name: 'Admin rename' })).status).toBe(200);
  await server.database.admin.query('DELETE FROM resources.project_member WHERE project_id=$1 AND user_id=$2', [project.id, outsider.userId]);
  expect((await request(outsider, `/${project.id}`, 'DELETE')).status).toBe(404);
});

test('member directory and management enforce project scope and protected roles', async () => {
  const admin = await actor('project-admin');
  const member = await actor('project-member');
  const target = await actor('project-target');
  const project = await (await request(owner, '', 'POST', { name: 'Member directory' })).json() as { id: string };
  const base = `/${project.id}/members`;
  expect((await request(outsider, base)).status).toBe(404);
  expect((await request(outsider, base, 'POST', { email: 'project-target@projects.test', role: 'member' })).status).toBe(404);
  const add = (email: string, role = 'member') => request(owner, base, 'POST', { email, role });
  expect((await add('project-admin@projects.test', 'admin')).status).toBe(201);
  expect((await add('project-member@projects.test')).status).toBe(201);
  const directory = await (await request(member, base)).json() as { actorRole: string; items: { userId: string; joinedAt: string; role: string }[] };
  expect(directory.actorRole).toBe('member'); expect(directory.items).toHaveLength(3);
  expect(directory.items.every(item => Number.isFinite(Date.parse(item.joinedAt)))).toBe(true);
  expect((await request(member, base, 'POST', { email: 'project-target@projects.test', role: 'member' })).status).toBe(403);
  expect((await request(member, `${base}/${admin.userId}`, 'DELETE')).status).toBe(403);
  expect((await request(admin, base, 'POST', { email: 'project-target@projects.test', role: 'admin' })).status).toBe(403);
  expect((await request(admin, base, 'POST', { email: 'project-target@projects.test', role: 'guest' })).status).toBe(201);
  expect((await add('project-target@projects.test')).status).toBe(409);
  expect((await add('missing@projects.test')).status).toBe(404);
  expect((await request(admin, `${base}/${owner.userId}`, 'DELETE')).status).toBe(403);
  expect((await request(owner, `${base}/${owner.userId}`, 'PATCH', { role: 'member' })).status).toBe(403);
  expect((await request(admin, `${base}/${member.userId}`, 'PATCH', { role: 'admin' })).status).toBe(403);
  expect((await request(owner, `${base}/${target.userId}`, 'PATCH', { role: 'admin' })).status).toBe(200);
  expect((await request(admin, `${base}/${target.userId}`, 'DELETE')).status).toBe(403);
  expect((await request(owner, `${base}/${target.userId}`, 'PATCH', { role: 'member' })).status).toBe(200);
  expect((await request(admin, `${base}/${target.userId}`, 'DELETE')).status).toBe(200);
  expect((await request(target, base)).status).toBe(404);
  expect((await request(owner, base, 'POST', { email: 'project-target@projects.test', role: 'owner' })).status).toBe(400);
  expect((await request(owner, base, 'POST', { email: 'project-target@projects.test', role: 'member', projectId: project.id })).status).toBe(400);
  expect((await request(owner, `${base}/${member.userId}`, 'DELETE')).status).toBe(200);
  expect((await request(member, base)).status).toBe(404);
});
