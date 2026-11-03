import { expect, test } from 'bun:test';
import type { FolderAccessPolicy } from '@fob/shared/knowledge/contracts';
import { folderPermissionFor, folderRows } from './folder-access-model';

const root: FolderAccessPolicy = { knowledgeBaseId: 'library', teamspaceId: 'root', parentId: null, name: 'Research', revision: 0, inheritsAccess: false, defaultAccess: 'edit', effectiveDefaultAccess: 'edit', defaultSourceId: 'root', explicit: [], grants: [] };
const child = { ...root, teamspaceId: 'child', parentId: 'root', name: 'Interviews', inheritsAccess: true };

test('folder search retains ancestor context and collapsed folders do not hide matching descendants', () => {
  expect(folderRows([child, root], '', new Set(['root'])).map((row) => row.folder.teamspaceId)).toEqual(['root']);
  const matches = folderRows([child, root], 'interview', new Set(['root']));
  expect(matches.map((row) => [row.folder.teamspaceId, row.depth])).toEqual([['root', 0], ['child', 1]]);
});

test('guest previews exclude defaults, and individual grants cannot reduce an ordinary member default', () => {
  expect(folderPermissionFor(root, { userId: 'guest', role: 'guest' }).level).toBeNull();
  const withGrant = { ...root, grants: [{ userId: 'person', level: 'view' as const, sourceId: 'root' }] };
  expect(folderPermissionFor(withGrant, { userId: 'person', role: 'member' }).level).toBe('edit');
  expect(folderPermissionFor(withGrant, { userId: 'person', role: 'guest' })).toEqual({ level: 'view', sourceId: 'root', individual: true });
});
