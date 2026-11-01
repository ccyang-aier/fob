export type CollectionKind = 'starred' | 'drafts' | 'trash' | 'recent' | 'documents';
export type CollectionEntry = { id: string; title: string; icon?: string | null; folderId?: string; creator?: string; date: string | null };
export type CollectionFolder = { id: string; name: string; parentId?: string | null };
export type CollectionSort = 'newest' | 'oldest' | 'title';

export function collectionFolderPath(id: string | undefined, folders: readonly CollectionFolder[], unfiled: string) {
  const byId = new Map(folders.map(folder => [folder.id, folder])), seen = new Set<string>(), names: string[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id); names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' / ') || unfiled;
}

export function collectionRows(entries: readonly CollectionEntry[], folders: readonly CollectionFolder[], query: string, sort: CollectionSort, locale: string, unfiled: string) {
  const search = query.trim().toLocaleLowerCase(locale);
  return entries.map(entry => ({ ...entry, folder: collectionFolderPath(entry.folderId, folders, unfiled) }))
    .filter(entry => !search || [entry.title, entry.folder, entry.creator ?? ''].some(value => value.toLocaleLowerCase(locale).includes(search)))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, locale) : (sort === 'oldest' ? 1 : -1) * ((Date.parse(a.date ?? '') || 0) - (Date.parse(b.date ?? '') || 0)) || a.title.localeCompare(b.title, locale));
}
