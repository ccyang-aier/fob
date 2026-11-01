export type TreeDragItem = { kind: 'folder' | 'document'; id: string };
export type TreeFolder = { id: string; parentId?: string | null };
export type TreeDocument = { id: string; folderId?: string; parentId?: string | null };
export type TreeMove = { kind: 'folder'; id: string; parentId: string | null } | { kind: 'document'; id: string; folderId: string };
export type DropRejection = 'missing' | 'cycle' | 'unchanged' | 'folderRequired';
export type TreeDrop = { ok: true; move: TreeMove } | { ok: false; reason: DropRejection };

/** A folder is an organizational parent; document parentage remains separate. */
export function resolveTreeDrop(folders: readonly TreeFolder[], documents: readonly TreeDocument[], item: TreeDragItem, targetId: string | null): TreeDrop {
  if (targetId !== null && !folders.some(folder => folder.id === targetId)) return { ok: false, reason: 'missing' };
  if (item.kind === 'document') {
    const document = documents.find(document => document.id === item.id);
    if (!document) return { ok: false, reason: 'missing' };
    if (targetId === null) return { ok: false, reason: 'folderRequired' };
    if (document.folderId === targetId && !document.parentId) return { ok: false, reason: 'unchanged' };
    return { ok: true, move: { kind: 'document', id: item.id, folderId: targetId } };
  }
  const folder = folders.find(folder => folder.id === item.id);
  if (!folder) return { ok: false, reason: 'missing' };
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const seen = new Set<string>();
  let ancestor = targetId;
  while (ancestor) {
    if (ancestor === item.id || seen.has(ancestor)) return { ok: false, reason: 'cycle' };
    seen.add(ancestor);
    ancestor = byId.get(ancestor)?.parentId ?? null;
  }
  if ((folder.parentId ?? null) === targetId) return { ok: false, reason: 'unchanged' };
  return { ok: true, move: { kind: 'folder', id: item.id, parentId: targetId } };
}
