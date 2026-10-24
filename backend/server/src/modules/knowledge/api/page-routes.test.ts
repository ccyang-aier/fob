import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createPermissionsFixture } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture } from '../permissions/permissions-test-fixture';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture(); }, 120_000);
afterAll(async () => { await fixture?.close(); }, 60_000);

describe('page HTTP lifecycle', () => {
  test('owner can create independent pages in restricted folders while members cannot', async () => {
    const root = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alphaKnowledgeBase.id, name: 'Restricted documents', defaultAccess: 'comment' });
    const input = { knowledgeBaseId: fixture.alpha.id, id: randomUUID(), teamspaceId: root.id, parentId: null, kind: 'doc' as const, databaseId: null, title: 'Independent', icon: '📚', inheritsPermissions: false };
    const owner = fixture.apiClient({ cookie: fixture.owner.cookie, origin: fixture.server.webOrigin });
    await owner.page.create.mutate(input);
    expect((await owner.page.list.query({ knowledgeBaseId: fixture.alpha.id })).find((row) => row.id === input.id)).toMatchObject({ title: input.title, icon: input.icon, inheritsPermissions: false });
    const reader = fixture.apiClient({ cookie: fixture.reader.cookie, origin: fixture.server.webOrigin });
    await expect(reader.page.create.mutate({ ...input, id: randomUUID() })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    expect((await reader.page.list.query({ knowledgeBaseId: fixture.alpha.id })).some((row) => row.id === input.id)).toBe(false);
  }, 30_000);
  test('create, list, rename, nest, recycle and restore with immediately usable ACLs', async () => {
    const root = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alphaKnowledgeBase.id, name: 'Documents', defaultAccess: 'edit' });
    const client = fixture.apiClient({ cookie: fixture.owner.cookie, origin: fixture.server.webOrigin });
    const input = { knowledgeBaseId: fixture.alpha.id, id: randomUUID(), teamspaceId: root.id, parentId: null, kind: 'doc' as const, databaseId: null, title: 'First document' };
    const created = await client.page.create.mutate(input);
    expect(created.pageId).toBe(input.id);
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: input.id };
    const member = fixture.apiClient({ cookie: fixture.reader.cookie, origin: fixture.server.webOrigin });
    await expect(member.page.recycle.mutate(scope)).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    expect((await client.page.access.query({ ...scope, action: 'edit' })).authorized).toBe(true);
    expect((await client.page.list.query({ knowledgeBaseId: fixture.alpha.id })).find((row) => row.id === input.id)?.title).toBe(input.title);
    expect((await client.page.update.mutate({ ...scope, title: 'Renamed' })).title).toBe('Renamed');
    const child = await client.page.create.mutate({ ...input, id: randomUUID(), parentId: input.id });
    await client.page.move.mutate({ knowledgeBaseId: input.knowledgeBaseId, pageId: child.pageId, parentId: null, teamspaceId: root.id, afterPageId: input.id, operationId: randomUUID() });
    expect((await client.page.list.query({ knowledgeBaseId: input.knowledgeBaseId, parentId: input.id })).length).toBe(0);
    await client.page.recycle.mutate(scope);
    expect((await member.page.list.query({ knowledgeBaseId: input.knowledgeBaseId })).some((row) => row.id === input.id)).toBe(false);
    await expect(member.page.restore.mutate(scope)).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    expect((await client.page.access.query({ ...scope, action: 'view' })).authorized).toBe(false);
    expect((await client.page.list.query({ knowledgeBaseId: input.knowledgeBaseId })).find((row) => row.id === input.id)?.deletedAt).not.toBeNull();
    await client.page.restore.mutate(scope);
    expect((await client.page.access.query({ ...scope, action: 'edit' })).authorized).toBe(true);
    expect((await client.page.create.mutate(input)).pageId).toBe(input.id);
    expect((await client.page.list.query({ knowledgeBaseId: input.knowledgeBaseId })).filter((row) => row.id === input.id)).toHaveLength(1);
  }, 30_000);

  test('read-only teamspaces deny creation and hidden pages never enter the directory', async () => {
    const tree = await fixture.tree({ defaultAccess: 'view', breaks: [0], parents: [null] });
    await fixture.drain();
    const client = fixture.apiClient({ cookie: fixture.reader.cookie, origin: fixture.server.webOrigin });
    await expect(client.page.create.mutate({ knowledgeBaseId: fixture.alpha.id, id: randomUUID(), teamspaceId: tree.teamspace.id, parentId: null, kind: 'doc', databaseId: null, title: 'Denied' })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    expect((await client.page.list.query({ knowledgeBaseId: fixture.alpha.id })).some((row) => row.id === tree.pages[0]!.pageId)).toBe(false);
  }, 30_000);

  test('cross-knowledgeBase destinations and write operations without write scope fail closed', async () => {
    const foreign = await fixture.organization.createTeamspace(fixture.foreign.identity, { knowledgeBaseId: fixture.betaKnowledgeBase.id, name: 'Private', defaultAccess: 'edit' });
    const client = fixture.apiClient({ cookie: fixture.owner.cookie, origin: fixture.server.webOrigin });
    await expect(client.page.create.mutate({ knowledgeBaseId: fixture.alpha.id, id: randomUUID(), teamspaceId: foreign.id, parentId: null, kind: 'doc', databaseId: null, title: 'Denied' })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    const authorization = await fixture.createToken(fixture.owner, ['read']);
    const reader = fixture.apiClient({ authorization });
    await expect(reader.page.recycle.mutate({ knowledgeBaseId: fixture.alpha.id, pageId: randomUUID() })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  }, 30_000);
});
