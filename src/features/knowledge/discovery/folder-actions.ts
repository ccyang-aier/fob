export type FolderBulkAction = 'star' | 'draft' | 'move' | 'trash';
export type FolderActions = {
  starredIds: readonly string[];
  draftIds: readonly string[];
  folders: readonly { id: string; name: string }[];
  canWrite: boolean;
  run(action: FolderBulkAction, ids: string[], folderId?: string): Promise<void>;
};
