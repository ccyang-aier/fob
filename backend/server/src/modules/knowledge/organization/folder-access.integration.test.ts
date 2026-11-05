import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FolderAccessPolicy } from '@fob/shared/knowledge/contracts';
import { teamspaceMemberAccess } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { authorizePageAccess } from '../permissions/authorization';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';

describe('folder member permissions over HTTP and PostgreSQL', () => {
  let fixture: PermissionsFixture;
  beforeAll(async () => { fixture = await createPermissionsFixture(); }, 30_000);
  beforeEach(async () => { await fixture.resetJobs(); });
  afterAll(async () => { if (fixture) { expect(fixture.errors).toEqual([]); await fixture.close(); } }, 30_000);

  async function policy(id: string) {
    return (await fixture.organization.listFolderAccess(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id })).find((item) => item.teamspaceId === id)!;
  }
  async function update(id: string, patch: Partial<Pick<FolderAccessPolicy, 'defaultAccess' | 'inheritsAccess' | 'explicit'>>) {
    const current = await policy(id);
    return fixture.organization.updateFolderAccess(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, teamspaceId: id,
      expectedRevision: current.revision, inheritsAccess: patch.inheritsAccess ?? current.inheritsAccess,
      defaultAccess: patch.defaultAccess === undefined ? current.defaultAccess : patch.defaultAccess, grants: patch.explicit === undefined ? current.explicit : [...current.explicit.filter(grant => grant.userId === fixture.owner.identity.userId), ...patch.explicit] });
  }
  async function decision(node: { knowledgeBaseId: string; pageId: string }, required: 'view' | 'edit' = 'edit') {
    return withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) => authorizePageAccess(db, { scope: { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId }, userId: fixture.reader.identity.userId, required }));
  }
  async function request(path: string, actor = fixture.owner, method = 'GET', body?: unknown) {
    return fetch(`${fixture.server.origin}/api/knowledge-bases/${fixture.alpha.id}${path}`, { method,
      headers: { cookie: actor.cookie, origin: fixture.server.webOrigin, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  }

  test('directory, writes, revision conflicts and grants stay within the selected knowledge base', async () => {
    const tree = await fixture.tree({ defaultAccess: null });
    const original = await policy(tree.teamspace.id);
    const body = { expectedRevision: original.revision, inheritsAccess: false, defaultAccess: null, grants: [...original.explicit, { userId: fixture.reader.identity.userId, level: 'edit' }] };
    expect((await request('/folder-access', fixture.reader)).status).toBe(200);
    expect((await request('/folder-access', fixture.foreign)).status).toBe(404);
    expect((await request(`/teamspaces/${tree.teamspace.id}/access`, fixture.reader, 'PATCH', body)).status).toBe(403);
    expect((await request(`/teamspaces/${tree.teamspace.id}/access`, fixture.owner, 'PATCH', { ...body, grants: [...original.explicit, { userId: fixture.foreign.identity.userId, level: 'view' }] })).status).toBe(404);
    expect((await request(`/teamspaces/${randomUUID()}/access`, fixture.owner, 'PATCH', body)).status).toBe(404);
    expect((await request(`/teamspaces/${tree.teamspace.id}/access`, fixture.owner, 'PATCH', { ...body, inheritsAccess: true })).status).toBe(400);
    expect((await policy(tree.teamspace.id)).explicit).toEqual(original.explicit);
    expect((await request(`/teamspaces/${tree.teamspace.id}/access`, fixture.owner, 'PATCH', body)).status).toBe(200);
    expect((await request(`/teamspaces/${tree.teamspace.id}/access`, fixture.owner, 'PATCH', { ...body, grants: [] })).status).toBe(409);
    expect((await policy(tree.teamspace.id)).explicit).toHaveLength(2);
    const hidden = await withKnowledgeBase(fixture.pool, fixture.beta.id, (db) => db.select().from(teamspaceMemberAccess).where(eq(teamspaceMemberAccess.knowledgeBaseId, fixture.alpha.id)));
    expect(hidden).toEqual([]);
  });

  test('inheritance grants actual page access, respects page breaks and fences revocations before workers run', async () => {
    const parent = await fixture.tree({ defaultAccess: null });
    const childFolder = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, name: 'Inherited child', parentId: parent.teamspace.id, defaultAccess: null });
    const child = await fixture.tree({ teamspace: childFolder, breaks: [1] });
    await update(childFolder.id, { inheritsAccess: true });
    await update(parent.teamspace.id, { explicit: [{ userId: fixture.reader.identity.userId, level: 'edit' }] });
    await fixture.drain();
    expect((await decision(parent.pages[0]!)).decision).toBe('allow');
    expect((await decision(child.pages[0]!)).decision).toBe('allow');
    expect((await decision(child.pages[1]!)).decision).toBe('deny');
    expect((await decision(child.pages[2]!)).decision).toBe('deny');
    expect((await policy(childFolder.id)).grants.find(grant => grant.userId === fixture.reader.identity.userId)?.sourceId).toBe(parent.teamspace.id);
    await update(parent.teamspace.id, { explicit: [] });
    expect((await decision(parent.pages[0]!)).decision).not.toBe('allow');
    expect((await decision(child.pages[0]!)).decision).not.toBe('allow');
    await fixture.drain();
    expect((await decision(child.pages[0]!)).decision).toBe('deny');
  });

  test('moving an inheriting folder fences its old access and uses the new parent', async () => {
    const first = await fixture.tree({ defaultAccess: 'edit' });
    const second = await fixture.tree({ defaultAccess: null });
    const childFolder = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, name: 'Movable child', parentId: first.teamspace.id, defaultAccess: null });
    const child = await fixture.tree({ teamspace: childFolder });
    await update(childFolder.id, { inheritsAccess: true }); await fixture.drain();
    expect((await decision(child.pages[0]!)).decision).toBe('allow');
    await fixture.organization.moveTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, teamspaceId: childFolder.id, parentId: second.teamspace.id });
    expect((await decision(child.pages[0]!)).decision).not.toBe('allow');
    await fixture.drain();
    expect((await decision(child.pages[0]!)).decision).toBe('deny');
  });
});
