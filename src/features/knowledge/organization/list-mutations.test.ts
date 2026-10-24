import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { applyOptimisticList, readListItems, restoreOptimisticList } from './cache';
import { organizationQueryKeys } from './keys';
import { applyMemberRole, applyTeamspacePatch, patchByKey, removeByKey, upsertByKey } from './list-mutations';
import type { MemberRow, TeamspaceRow } from './list-mutations';

const ws = '10000000-0000-4000-8000-000000000001';
const alice: MemberRow = { knowledgeBaseId: ws, userId: '20000000-0000-4000-8000-000000000002', role: 'member', name: 'Alice', email: 'alice@example.com' };
const bob: MemberRow = { knowledgeBaseId: ws, userId: '30000000-0000-4000-8000-000000000003', role: 'admin', name: 'Bob', email: 'bob@example.com' };

describe('pure list reducers', () => {
  test('patchByKey updates only the matching row and preserves the rest', () => {
    const next = applyMemberRole([alice, bob], alice.userId, 'guest');
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ userId: alice.userId, role: 'guest', name: 'Alice' });
    expect(next[1]?.role).toBe('admin');
    // The original array is untouched — snapshots stay valid for rollback.
    expect(alice.role).toBe('member');
  });

  test('removeByKey drops the row; patching or removing a missing key is a no-op copy', () => {
    const removed = removeByKey([alice, bob], (row: MemberRow) => row.userId, alice.userId);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.name).toBe('Bob');
    const untouched = patchByKey([alice], (row: MemberRow) => row.userId, 'missing', { role: 'owner' });
    expect(untouched).toHaveLength(1);
    expect(untouched[0]?.role).toBe('member');
    expect(removeByKey([alice], (row: MemberRow) => row.userId, 'missing')).toHaveLength(1);
  });

  test('upsertByKey replaces on key match and appends otherwise', () => {
    const renamedBob = { ...bob, name: 'Bobby' };
    expect(upsertByKey([alice, bob], (row: MemberRow) => row.userId, renamedBob)[1]?.name).toBe('Bobby');
    const added = upsertByKey([alice], (row: MemberRow) => row.userId, bob);
    expect(added).toHaveLength(2);
    expect(added[1]?.name).toBe('Bob');
  });

  test('teamspace patches cover both rename and default access', () => {
    const teamspace: TeamspaceRow = {  knowledgeBaseId: ws, id: '40000000-0000-4000-8000-000000000004', name: '文档', defaultAccess: null };
    expect(applyTeamspacePatch([teamspace], teamspace.id, { defaultAccess: 'edit' })[0]?.defaultAccess).toBe('edit');
    expect(applyTeamspacePatch([teamspace], teamspace.id, { name: '文档库' })[0]?.name).toBe('文档库');
    expect(applyTeamspacePatch([teamspace], teamspace.id, { name: '文档库' })[0]?.defaultAccess).toBe(null);
  });
});

/** The real rollback path: snapshot → optimistic apply → restore through QueryClient. */
describe('optimistic cache rollback', () => {
  function memberCache(): QueryClient {
    const queryClient = new QueryClient();
    queryClient.setQueryData(organizationQueryKeys.members(ws), {
      pages: [{ items: [alice, bob], nextCursor: null }],
      pageParams: [null],
    });
    return queryClient;
  }

  test('a role change applies optimistically and the snapshot restores it verbatim', () => {
    const queryClient = memberCache();
    const key = organizationQueryKeys.members(ws);
    const snapshot = applyOptimisticList<MemberRow>(queryClient, key, (items) => applyMemberRole(items, bob.userId, 'owner'));
    expect(readListItems<MemberRow>(queryClient.getQueryData(key))[1]?.role).toBe('owner');

    restoreOptimisticList(queryClient, snapshot);
    const restored = readListItems<MemberRow>(queryClient.getQueryData(key));
    expect(restored[1]?.role).toBe('admin');
    expect(restored[0]?.name).toBe('Alice');
  });

  test('a removal rolls back completely, restoring every row', () => {
    const queryClient = memberCache();
    const key = organizationQueryKeys.members(ws);
    const snapshot = applyOptimisticList<MemberRow>(queryClient, key, (items) => removeByKey(items, (row) => row.userId, alice.userId));
    expect(readListItems<MemberRow>(queryClient.getQueryData(key))).toHaveLength(1);

    restoreOptimisticList(queryClient, snapshot);
    expect(readListItems<MemberRow>(queryClient.getQueryData(key))).toHaveLength(2);
  });

  test('a failed create rolls its optimistic row back out of the cache', () => {
    const queryClient = new QueryClient();
    const key = organizationQueryKeys.groups(ws);
    queryClient.setQueryData(key, { pages: [{ items: [], nextCursor: null }], pageParams: [null] });
    const tempRow = { knowledgeBaseId: ws, id: 'pending-create', name: '设计组' };

    const snapshot = applyOptimisticList(queryClient, key, (items: typeof tempRow[]) => [...items, tempRow]);
    expect(readListItems<typeof tempRow>(queryClient.getQueryData(key))).toHaveLength(1);

    // The server row replaces the temp id on success…
    const serverRow = { knowledgeBaseId: ws, id: '50000000-0000-4000-8000-000000000005', name: '设计组' };
    applyOptimisticList(queryClient, key, (items: typeof tempRow[]) => upsertByKey(removeByKey(items, (row) => row.id, tempRow.id), (row) => row.id, serverRow));
    expect(readListItems<typeof tempRow>(queryClient.getQueryData(key))[0]?.id).toBe(serverRow.id);

    // …and on failure the snapshot drops the optimistic row entirely.
    restoreOptimisticList(queryClient, snapshot);
    expect(readListItems<typeof tempRow>(queryClient.getQueryData(key))).toHaveLength(0);
  });

  test('a cache miss yields a null snapshot and restoring it is a no-op', () => {
    const queryClient = new QueryClient();
    const key = organizationQueryKeys.teamspaces(ws);
    const snapshot = applyOptimisticList<TeamspaceRow>(queryClient, key, (items) => items);
    expect(snapshot).toBe(null);
    expect(queryClient.getQueryData(key)).toBe(undefined);
    restoreOptimisticList(queryClient, snapshot);
    expect(queryClient.getQueryData(key)).toBe(undefined);
  });
});
