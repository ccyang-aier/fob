import { formatDate, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-folders.messages';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { DotsThree } from '@/components/icons';
import { FolderArtwork } from './document-visuals';
import type { DocumentFolder } from './types';
import styles from './documents-page.module.css';
export function DocumentFolders({
  visibleFolders,
  allFolders,
  onOpenFolder,
  onCreateFolder,
  canEdit,
}: {
  visibleFolders: DocumentFolder[];
  allFolders: boolean;
  onOpenFolder: (id: string) => void;
  onCreateFolder?: () => void;
  canEdit: boolean;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);
  return (
    <div className={styles.folders}>
      {(allFolders ? visibleFolders : visibleFolders.slice(0, 4)).map((folder, index) => (
        <div key={folder.id} className={styles.folder}>
          <button className={styles.folderOpen} onClick={() => onOpenFolder(folder.id)}>
            <FolderArtwork index={index} />
            <strong>{folder.name}</strong>
            <small>
              {folder.count} {knowledgeT(folder.count === 1 ? 'oneItem' : 'items')}
              {folder.updatedAt
                ? ` · ${formatDate(folder.updatedAt, { month: 'short', day: 'numeric' }, locale)}`
                : ''}
            </small>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={styles.folderMore}
                aria-label={knowledgeT('valueFolderActions', { v0: folder.name })}
              >
                <DotsThree size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpenFolder(folder.id)}>
                {knowledgeT('openFolder')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      {!visibleFolders.length ? (
        <div className={styles.folderEmpty}>
          {knowledgeT('noFolders')}
          {onCreateFolder ? (
            <button onClick={onCreateFolder} disabled={!canEdit}>
              {knowledgeT('newFolder')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
