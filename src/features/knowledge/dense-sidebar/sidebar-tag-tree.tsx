'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './sidebar-tag-tree.messages';
import { CaretDown, CaretRight, DotsThree, PencilSimple, Trash } from '@/components/icons';

import {
  SidebarCreateIcon,
  SidebarDocumentActions,
  sidebarDocumentIconClass,
} from '@/features/knowledge/dense-sidebar/sidebar-navigation-primitives';
import type { DocumentAction } from '@/features/knowledge/dense-sidebar/document-action-menu-content';
import type { SidebarDocumentSummary } from '@/features/knowledge/dense-sidebar/sidebar-navigation';
import type { TagSummary } from '@/features/knowledge/dense-sidebar/sidebar-navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageIcon } from '../navigation/page-icon';
import { cn } from '@/lib/utils';
import { useI18n } from '@/features/knowledge/dense-sidebar/use-i18n';
import { IconButton } from './icon-button';
import styles from './sidebar-interactions.module.css';

export type SidebarTagAction = 'new-document' | 'rename' | 'delete';

export function SidebarTagTreeNode({
  tag,
  documents,
  expanded,
  activeDocumentId,
  activeDocumentLocation,
  onToggle,
  onSelectDocument,
  onTagAction,
  onDocumentAction,
}: {
  tag: TagSummary;
  documents: SidebarDocumentSummary[];
  expanded: boolean;
  activeDocumentId: string | null;
  activeDocumentLocation: 'project' | 'recent' | 'tag' | null;
  onToggle: (tagId: string) => void;
  onSelectDocument: (documentId: string) => void;
  onTagAction: (tagId: string, action: SidebarTagAction) => void;
  onDocumentAction: (documentId: string, action: DocumentAction) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { t } = useI18n();
  const hasDocuments = documents.length > 0;

  return (
    <div role="treeitem" aria-expanded={hasDocuments ? expanded : undefined} aria-selected={false}>
      <div
        className={cn(
          styles.row,
          'group flex h-[29px] w-full items-center rounded-[6px] pr-1 text-[12px] leading-none text-[var(--sidebar-text)]',
        )}
        style={{ paddingLeft: 5 }}
      >
        {hasDocuments ? (
          <IconButton
            type="button"
            label={t(expanded ? 'sidebar.collapseSection' : 'sidebar.expandSection', {
              section: tag.name,
            })}
            tooltip={expanded ? knowledgeT('collapse') : knowledgeT('expand')}
            aria-expanded={expanded}
            data-variant="disclosure"
            onClick={() => onToggle(tag.id)}
            className="mr-0.5 inline-flex size-[17px] shrink-0 items-center justify-center rounded-[4px] outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
          >
            {expanded ? (
              <CaretDown aria-hidden="true" size={12} />
            ) : (
              <CaretRight aria-hidden="true" size={12} />
            )}
          </IconButton>
        ) : (
          <span className="mr-0.5 size-[17px] shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onToggle(tag.id)}
          className="flex h-full min-w-0 flex-1 items-center text-left outline-none"
        >
          <span
            aria-hidden="true"
            className="mr-2 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          <span className="my-auto inline-flex h-4 min-w-0 items-center truncate leading-4">
            {tag.name}
          </span>
        </button>
        <div className={styles.trailing}>
          <div className={cn(styles.actions, 'flex items-center gap-0.5')}>
            <IconButton
              type="button"
              label={t('sidebar.newDocumentInTag', { tag: tag.name })}
              tooltip={knowledgeT('newDocument')}
              className={styles.actionButton}
              onClick={() => onTagAction(tag.id, 'new-document')}
            >
              <SidebarCreateIcon />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  type="button"
                  label={t('sidebar.tagMenu', { tag: tag.name })}
                  tooltip={knowledgeT('more')}
                  className={styles.actionButton}
                  onClick={(event) => event.stopPropagation()}
                >
                  <DotsThree aria-hidden="true" size={16} />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[170px]">
                <DropdownMenuItem onSelect={() => onTagAction(tag.id, 'rename')}>
                  <PencilSimple size={14} /> {t('sidebar.rename')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onTagAction(tag.id, 'delete')}
                >
                  <Trash size={14} /> {t('sidebar.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <span className={styles.count}>{documents.length}</span>
        </div>
      </div>

      {hasDocuments && expanded ? (
        <div role="group" className="space-y-0.5 pt-0.5">
          {documents.map((document) => {
            const selected = activeDocumentLocation === 'tag' && activeDocumentId === document.id;
            return (
              <div
                key={document.id}
                data-selected={selected ? 'true' : undefined}
                className={cn(
                  styles.row,
                  'group flex h-[29px] w-full items-center rounded-[6px] pr-1 text-[12px] leading-none text-[var(--sidebar-text)]',
                  selected && 'font-medium text-foreground',
                )}
                style={{ paddingLeft: 30 }}
              >
                <button
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => onSelectDocument(document.id)}
                  className="flex h-full min-w-0 flex-1 items-center text-left outline-none"
                >
                  <PageIcon value={document.icon} size={14} className={sidebarDocumentIconClass} />
                  <span className={styles.documentLabel} title={document.title}>
                    {document.title}
                  </span>
                </button>
                <SidebarDocumentActions
                  documentId={document.id}
                  starred={document.starred}
                  onAction={onDocumentAction}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
