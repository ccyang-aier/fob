import assert from 'node:assert/strict';
import { test } from 'node:test';
import { principal } from '@fob/shared/knowledge/contracts';
import type { PageAcl, PermissionLevel } from '@fob/shared/knowledge/contracts';
import { canAccess, computeEffectivePermissions, expandPrincipals, permissionFor, restrictDuringRebuild } from './effective';
import type { PermissionNode } from './effective';

const uid = (n: number) => `01991428-716d-7453-8d22-${String(n).padStart(12, '0')}`;
const knowledgeBaseId = uid(1), teamspaceId = uid(2), userId = uid(3), groupId = uid(4);
const user = principal('user', userId), group = principal('group', groupId), knowledgeBase = principal('knowledgeBase', knowledgeBaseId);
const grant = (pageId: string, subject: PageAcl['principal'], level: PermissionLevel): PageAcl => ({ knowledgeBaseId, pageId, principal: subject, level, inherited: false });
const node = (id: string, parentId: string | null, grants: PageAcl[] = [], inheritsPermissions = true): PermissionNode => ({ id, parentId, grants, inheritsPermissions, knowledgeBaseId, teamspaceId });
const compute = (lineage: PermissionNode[], defaultAccess: PermissionLevel | null = 'view') => computeEffectivePermissions({ knowledgeBaseId, teamspaceId, defaultAccess, lineage });

test('four levels are cumulative and explicit lower grants never diminish an inherited grant', () => {
  const root = node(uid(5), null, [grant(uid(5), user, 'edit'), grant(uid(5), group, 'comment')]);
  const child = node(uid(6), root.id, [grant(uid(6), user, 'view')]);
  const acl = compute([root, child]);
  assert.deepEqual(acl.view, [group, user, knowledgeBase].sort());
  assert.deepEqual(acl.comment, [group, user].sort());
  assert.deepEqual(acl.edit, [user]);
  assert.deepEqual(acl.full, []);
  assert.equal(permissionFor([user, group, knowledgeBase], acl), 'edit');
  assert.equal(canAccess([group], acl, 'edit'), false);
  assert.equal(canAccess([user], acl, 'comment'), true);
});

test('breaking inheritance cuts ancestor and teamspace grants, and descendants inherit only the new scope', () => {
  const root = node(uid(5), null, [grant(uid(5), user, 'full')]);
  const child = node(uid(6), root.id, [grant(uid(6), group, 'comment')], false);
  const leaf = node(uid(7), child.id);
  const acl = compute([root, child, leaf]);
  assert.equal(permissionFor([user, knowledgeBase], acl), null);
  assert.equal(permissionFor([group], acl), 'comment');
  assert.deepEqual(compute([node(uid(5), null)], null), { view: [], comment: [], edit: [], full: [] });
});

test('only authenticated membership contributes group/knowledgeBase principals; links stay isolated', () => {
  const member = { knowledgeBaseId, userId, role: 'guest' as const };
  const principals = expandPrincipals({ knowledgeBaseId, userId, member, groups: [{ knowledgeBaseId, userId, groupId }] });
  assert.deepEqual(principals, [user, group, knowledgeBase].sort());
  const link = { knowledgeBaseId, id: uid(8) };
  assert.deepEqual(expandPrincipals({ knowledgeBaseId, userId: null, member: null, groups: [], links: [link] }), [principal('link', link.id)]);
  assert.throws(() => expandPrincipals({ knowledgeBaseId, userId, member: null, groups: [{ knowledgeBaseId, userId, groupId }] }), /Group membership/);
  assert.throws(() => expandPrincipals({ knowledgeBaseId, userId, member: { ...member, knowledgeBaseId: uid(99) }, groups: [] }), /Membership/);
  assert.throws(() => expandPrincipals({ knowledgeBaseId, userId, member: null, groups: [], links: [{ ...link, knowledgeBaseId: uid(99) }] }), /Share link/);
});

test('group removal takes effect without rebuilding page permission arrays', () => {
  const acl = compute([node(uid(5), null, [grant(uid(5), group, 'edit')])], null);
  const input = { knowledgeBaseId, userId, member: { knowledgeBaseId, userId, role: 'member' as const } };
  assert.equal(canAccess(expandPrincipals({ ...input, groups: [{ knowledgeBaseId, userId, groupId }] }), acl, 'edit'), true);
  assert.equal(canAccess(expandPrincipals({ ...input, groups: [] }), acl, 'view'), false);
});

test('revocation and privilege reduction are effective during asynchronous rebuilds', () => {
  const old = compute([node(uid(5), null, [grant(uid(5), user, 'full')])]);
  const desired = compute([node(uid(5), null, [grant(uid(5), user, 'view'), grant(uid(5), group, 'full')])], null);
  const pending = restrictDuringRebuild(old, desired);
  assert.equal(permissionFor([user], pending), 'view');
  assert.equal(permissionFor([knowledgeBase], pending), null);
  assert.equal(permissionFor([group], pending), null);
});

test('malformed lineage cannot accidentally inherit grants across resources or detached ancestors', () => {
  const root = node(uid(5), null);
  assert.throws(() => compute([]), /required/);
  assert.throws(() => compute([root, node(uid(6), uid(99))]), /incomplete or cyclic/);
  assert.throws(() => compute([root, node(root.id, root.id)]), /incomplete or cyclic/);
  assert.throws(() => compute([{ ...root, knowledgeBaseId: uid(99) }]), /crosses/);
  assert.throws(() => compute([node(uid(5), null, [grant(uid(99), user, 'full')])]), /explicit ACL/);
});
