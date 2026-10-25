'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './sidebar-project-tree.messages';
import {
  CaretDown,
  CaretRight,
  DotsThree,
  FilePlus,
  PencilSimple,
  Star,
  Tag,
  Trash,
} from '@/components/icons';

import {
  ProjectGlyph,
  SidebarCreateIcon,
  SidebarDocumentActions,
  sidebarDocumentIconClass,
} from '@/features/knowledge/dense-sidebar/sidebar-navigation-primitives';
import type { DocumentAction } from '@/features/knowledge/dense-sidebar/document-action-menu-content';
import type { SidebarProjectNode } from '@/features/knowledge/dense-sidebar/sidebar-navigation';
import { useI18n } from '@/features/knowledge/dense-sidebar/use-i18n';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from './icon-button';
import styles from './sidebar-interactions.module.css';
import { FolderSubscriptionMenuItem } from '../subscriptions/subscription-menu-item';
import { PageIcon } from '../navigation/page-icon';

export type SidebarProjectAction = 'new-document' | 'rename' | 'add-tag' | 'toggle-star' | 'delete';

export function SidebarProjectTreeNode({
  node,
  depth,
  expanded,
  selectedProjectId,
  activeDocumentId,
  activeDocumentLocation,
  onToggle,
  onSelectProject,
  onSelectDocument,
  onProjectAction,
  onDocumentAction,
}: {
  node: SidebarProjectNode;
  depth: number;
  expanded: Record<string, boolean>;
  selectedProjectId: string | null;
  activeDocumentId: string | null;
  activeDocumentLocation: 'project' | 'recent' | null;
  onToggle: (id: string) => void;
  onSelectProject: (id: string) => void;
  onSelectDocument: (id: string) => void;
  onProjectAction: (id: string, action: SidebarProjectAction) => void;
  onDocumentAction: (id: string, action: DocumentAction) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { t } = useI18n();
  const isDocument = node.kind === 'document';
  const isExpanded = expanded[node.id] ?? Boolean(node.defaultExpanded);
  const selected = isDocument
    ? activeDocumentLocation === 'project' && activeDocumentId === node.id
    : selectedProjectId === `project:${node.id}`;
  const label = node.label ?? (node.labelKey ? t(node.labelKey) : '');

  return (
    <div
      role="treeitem"
      aria-expanded={node.expandable ? isExpanded : undefined}
      aria-selected={selected}
    >
      <div
        data-selected={selected ? 'true' : undefined}
        className={cn(
          styles.row,
          'group flex h-[29px] w-full items-center rounded-[6px] pr-1 text-[12px] leading-none text-[var(--sidebar-text)]',
          selected && 'font-medium text-foreground',
        )}
        style={{ paddingLeft: isDocument ? 18 + depth * 12 : 5 + depth * 14 }}
      >
        {node.expandable ? (
          <IconButton
            type="button"
            label={t(isExpanded ? 'sidebar.collapseSection' : 'sidebar.expandSection', {
              section: label,
            })}
            tooltip={isExpanded ? knowledgeT('collapse') : knowledgeT('expand')}
            aria-expanded={isExpanded}
            data-variant="disclosure"
            onClick={() => onToggle(node.id)}
            className="mr-0.5 inline-flex size-[17px] shrink-0 items-center justify-center rounded-[4px] outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
          >
            {isExpanded ? (
              <CaretDown aria-hidden="true" size={12} />
            ) : (
              <CaretRight aria-hidden="true" size={12} />
            )}
          </IconButton>
        ) : !isDocument ? (
          <span className="mr-0.5 size-[17px] shrink-0" />
        ) : null}
        <button
          type="button"
          aria-current={selected ? 'page' : undefined}
          onClick={() => {
            if (isDocument) onSelectDocument(node.id);
            else onSelectProject(node.id);
          }}
          className="flex h-full min-w-0 flex-1 items-center text-left outline-none"
        >
          {isDocument ? (
            <PageIcon value={node.documentIcon} size={14} className={sidebarDocumentIconClass} />
          ) : (
            <ProjectGlyph iconId={node.projectIconId} />
          )}
          <span className={styles.documentLabel} title={label}>
            {label}
          </span>
        </button>
        {isDocument ? (
          <SidebarDocumentActions
            documentId={node.id}
            starred={Boolean(node.starred)}
            onAction={onDocumentAction}
          />
        ) : (
          <div className={styles.trailing}>
            <div className={cn(styles.actions, 'flex items-center gap-0.5')}>
              <IconButton
                type="button"
                label={t('sidebar.newDocument')}
                className={styles.actionButton}
                onClick={() => onProjectAction(node.id, 'new-document')}
              >
                <SidebarCreateIcon />
              </IconButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    type="button"
                    label={t('sidebar.projectMenu', { project: label })}
                    tooltip={knowledgeT('more')}
                    className={styles.actionButton}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DotsThree aria-hidden="true" size={16} />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[190px]">
                  <DropdownMenuItem onSelect={() => onProjectAction(node.id, 'rename')}>
                    <PencilSimple size={14} /> {t('sidebar.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onProjectAction(node.id, 'new-document')}>
                    <FilePlus size={14} /> {t('sidebar.addDocument')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onProjectAction(node.id, 'add-tag')}>
                    <Tag size={14} /> {t('sidebar.addTag')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onProjectAction(node.id, 'toggle-star')}>
                    <Star size={14} />{' '}
                    {node.starred ? t('sidebar.removeFavorite') : t('sidebar.addFavorite')}
                  </DropdownMenuItem>
                  <FolderSubscriptionMenuItem folderId={node.id} />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => onProjectAction(node.id, 'delete')}
                  >
                    <Trash size={14} /> {t('sidebar.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <span className={styles.count}>{node.count ?? 0}</span>
          </div>
        )}
      </div>

      {node.children?.length && isExpanded ? (
        <div role="group" className="space-y-0.5 pt-0.5">
          {node.children.map((child) => (
            <SidebarProjectTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedProjectId={selectedProjectId}
              activeDocumentId={activeDocumentId}
              activeDocumentLocation={activeDocumentLocation}
              onToggle={onToggle}
              onSelectProject={onSelectProject}
              onSelectDocument={onSelectDocument}
              onProjectAction={onProjectAction}
              onDocumentAction={onDocumentAction}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
