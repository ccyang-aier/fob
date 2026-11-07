import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { principal } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture(); }, 60_000);
beforeEach(async () => { await fixture.resetJobs(); });
afterAll(async () => { if (fixture) { expect(fixture.errors).toEqual([]); await fixture.close(); } }, 30_000);
const client = () => fixture.apiClient({ cookie: fixture.reader.cookie });

test('document people filter before pagination and expose only collaborator names and avatars', async () => {
  const tree = await fixture.tree({ defaultAccess: 'view' }); await fixture.drain();
  const first = await client().page.people.query({ ...tree.root, limit: 1 });
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toBeTruthy();
  const second = await client().page.people.query({ ...tree.root, limit: 1, cursor: first.nextCursor! });
  expect(second.items).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect([...first.items, ...second.items].map(row => row.userId).sort()).toEqual([fixture.owner.identity.userId, fixture.reader.identity.userId].sort());
  expect(Object.keys(first.items[0]!).sort()).toEqual(['image', 'name', 'userId']);
  const other = await fixture.tree({ resource: 'beta' }); await fixture.drain();
  await expect(client().page.people.query(other.root)).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  await expect(client().page.people.query({ ...tree.root, pageId: other.root.pageId })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
});

test('explicit and group collaborators remain usable without opening the member directory; revocation fails closed', async () => {
  const invitation = await fixture.organization.createInvitation(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, email: fixture.foreign.identity.email, role: 'guest' });
  await fixture.organization.acceptInvitation(fixture.foreign.identity, { knowledgeBaseId: fixture.alpha.id, invitationId: invitation.invitation.id, token: invitation.token });
  const group = await fixture.legacyGroups.create(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, name: 'Shared document' });
  await fixture.legacyGroups.add(fixture.owner.identity, { ...group, groupId: group.id, userId: fixture.foreign.identity.userId });
  const tree = await fixture.tree({ defaultAccess: null });
  const grants = [
    { principal: principal('user', fixture.reader.identity.userId), level: 'view' as const },
    { principal: principal('group', group.id), level: 'view' as const },
  ];
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => replaceAuthorizedPageAcl(db, { ...tree.root, grants }));
  await fixture.drain();
  const people = await client().page.people.query(tree.root);
  expect(people.items.map(row => row.userId).sort()).toEqual([fixture.owner.identity.userId, fixture.reader.identity.userId, fixture.foreign.identity.userId].sort());
  await expect(fixture.organization.listMembers(fixture.reader.identity, { knowledgeBaseId: fixture.alpha.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await fixture.legacyGroups.remove(fixture.owner.identity, { knowledgeBaseId: fixture.alpha.id, groupId: group.id, userId: fixture.foreign.identity.userId });
  expect((await client().page.people.query(tree.root)).items.map(row => row.userId).sort()).toEqual([fixture.owner.identity.userId, fixture.reader.identity.userId].sort());
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => replaceAuthorizedPageAcl(db, { ...tree.root, grants: [] }));
  await expect(client().page.people.query(tree.root)).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
});
