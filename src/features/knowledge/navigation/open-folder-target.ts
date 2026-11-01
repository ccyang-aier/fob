export type OpenFolderTarget = { knowledgeBaseId: string; folderId: string };
const listeners = new Set<(target: OpenFolderTarget) => void>();

/** Resource adapters own folder selection and the overview mode, including when their tab is hidden. */
export function subscribeOpenFolderTarget(listener: (target: OpenFolderTarget) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requestOpenFolder(target: OpenFolderTarget) {
  for (const listener of [...listeners]) listener(target);
}
