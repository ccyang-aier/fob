import { expect, test } from 'bun:test';
import { resolveTreeDrop } from './tree-drop-policy';

const folders = [{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'other' }];
test('folders can move into another branch and back to the top level', () => {
  expect(resolveTreeDrop(folders, [], { kind: 'folder', id: 'b' }, 'other')).toEqual({ ok: true, move: { kind: 'folder', id: 'b', parentId: 'other' } });
  expect(resolveTreeDrop(folders, [], { kind: 'folder', id: 'b' }, null)).toEqual({ ok: true, move: { kind: 'folder', id: 'b', parentId: null } });
  for (const target of ['a', 'b', 'c']) expect(resolveTreeDrop(folders, [], { kind: 'folder', id: 'a' }, target)).toEqual({ ok: false, reason: 'cycle' });
  expect(resolveTreeDrop(folders, [], { kind: 'folder', id: 'b' }, 'a')).toEqual({ ok: false, reason: 'unchanged' });
  expect(resolveTreeDrop(folders, [], { kind: 'folder', id: 'b' }, 'removed')).toEqual({ ok: false, reason: 'missing' });
});
test('documents target any depth of folder and cannot lose their folder by dropping on the heading', () => {
  const documents = [{ id: 'doc', folderId: 'a' }, { id: 'child-page', folderId: 'a', parentId: 'doc' }];
  expect(resolveTreeDrop(folders, documents, { kind: 'document', id: 'doc' }, 'c')).toEqual({ ok: true, move: { kind: 'document', id: 'doc', folderId: 'c' } });
  expect(resolveTreeDrop(folders, documents, { kind: 'document', id: 'doc' }, null)).toEqual({ ok: false, reason: 'folderRequired' });
  expect(resolveTreeDrop(folders, documents, { kind: 'document', id: 'doc' }, 'a')).toEqual({ ok: false, reason: 'unchanged' });
  expect(resolveTreeDrop(folders, documents, { kind: 'document', id: 'child-page' }, 'a').ok).toBe(true);
});
