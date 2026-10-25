'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './sidebar-navigation-primitives.messages';
import * as React from 'react';
import { PageIcon } from '../navigation/page-icon';
import {
  Archive,
  CalendarDots,
  CaretRight,
  CheckSquareOffset,
  FileText,
  Folder,
  FolderOpen,
  HashStraight,
  House,
  ImageSquare,
  Plant,
  Plus,
  SquaresFour,
  Star,
  TrashSimple,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';

import { ProjectIcon } from '@/features/knowledge/dense-sidebar/project-icon';
import type { ProjectIconId } from '@/features/knowledge/dense-sidebar/project-icons';
import type { DocumentAction } from '@/features/knowledge/dense-sidebar/document-action-menu-content';
import type { SidebarIconName, SidebarNavigationItem } from '@/features/knowledge/dense-sidebar/sidebar-navigation';
import { cn } from '@/lib/utils';
import { IconButton } from './icon-button';
import { SidebarDocumentMenu } from '@/features/knowledge/dense-sidebar/sidebar-document-menu';
import styles from './sidebar-interactions.module.css';

export const sidebarIconMap: Record<SidebarIconName, PhosphorIcon> = {
  home: House,
  star: Star,
  archive: Archive,
  trash: TrashSimple,
  hash: HashStraight,
  calendar: CalendarDots,
  sprout: Plant,
  image: ImageSquare,
  file: FileText,
  folder: FolderOpen,
  tasks: CheckSquareOffset,
  blocks: SquaresFour,
};

// Copied from Dense's sidebar functional palette and filled icon treatment.
export const sidebarIconToneClasses = {
  teal: 'text-[#3f8990]',
  amber: 'text-[#e9ad16]',
  indigo: 'text-[#667dc4]',
  rose: 'text-[#d76d68]',
} satisfies Record<NonNullable<SidebarNavigationItem['tone']>, string>;

export function SidebarCreateIcon() {
  return <Plus aria-hidden="true" size={14} weight="regular" />;
}

export const sidebarDocumentIconClass =
  'mr-2 shrink-0 text-[var(--muted-strong)] transition-colors duration-150 ease-out group-hover:text-foreground group-focus-within:text-foreground group-data-[selected=true]:text-foreground';


export function SidebarSectionHeader({
  icon: Icon,
  label,
  expanded,
  onToggle,
  selected,
  actions,
  count,
}: {
  icon: PhosphorIcon;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  selected?: boolean;
  actions?: React.ReactNode;
  count?: number;
}) {
  return (
    <div
      data-selected={selected ? 'true' : undefined}
      className={cn(
        styles.row,
        'group/section flex h-[30px] items-center rounded-[6px] pl-1.5 pr-1',
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={label}
        onClick={onToggle}
        className="flex h-full min-w-0 flex-1 items-center text-left text-[13px] font-medium text-[var(--sidebar-heading)] outline-none"
      >
        <Icon aria-hidden size={15} weight="fill" className="mr-2 shrink-0 text-[var(--muted-strong)]" />
        <span className="truncate">{label}</span>
        <CaretRight
          aria-hidden weight="regular"
          className={cn(
            'ml-1 size-[10px] shrink-0 transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        />
      </button>
      <div className={styles.trailing}>
        {actions && <div className={cn(styles.actions, 'flex items-center gap-px')}>{actions}</div>}
        {count !== undefined && <span className={styles.count}>{count}</span>}
      </div>
    </div>
  );
}

export function SidebarCollapsibleContent({
  expanded,
  children,
  className,
  contentClassName,
}: {
  expanded: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div
      aria-hidden={!expanded}
      inert={!expanded}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
        expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
    >
      <div className={cn('min-h-0 overflow-hidden', contentClassName)}>{children}</div>
    </div>
  );
}

export function SidebarRow({
  label,
  icon: Icon,
  selected,
  count,
  compact,
  iconOnly,
  iconTone,
  depth = 0,
  leading,
  onClick,
  ...buttonProps
}: {
  label: string;
  icon?: PhosphorIcon;
  selected?: boolean;
  count?: number;
  compact?: boolean;
  iconOnly?: boolean;
  iconTone?: SidebarNavigationItem['tone'];
  depth?: number;
  leading?: React.ReactNode;
  onClick: () => void;
} & Omit<React.ComponentProps<'button'>, 'onClick'>) {
  return (
    <button
      {...buttonProps}
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      data-selected={selected ? 'true' : undefined}
      aria-label={iconOnly ? label : undefined}
      className={cn(
        styles.row,
        'group flex items-center rounded-[6px] text-left leading-none text-[var(--sidebar-text)] outline-none',
        iconOnly ? 'mx-auto size-8 justify-center' : 'h-[30px] w-full pr-1',
        compact ? 'text-[12px]' : 'text-[13px]',
        selected && 'font-medium text-foreground',
      )}
      style={iconOnly ? undefined : { paddingLeft: 4 + depth * 18 }}
    >
      {leading ??
        (Icon ? (
          <Icon
            aria-hidden="true"
            size={15}
            weight="fill"
            data-icon-tone={iconTone}
            className={cn('shrink-0', !iconOnly && 'mr-2', iconTone ? sidebarIconToneClasses[iconTone] : 'text-[var(--sidebar-icon)]')}
          />
        ) : null)}
      {!iconOnly && <span className="my-auto inline-flex h-4 min-w-0 items-center truncate leading-4">
        {label}
      </span>}
      {!iconOnly && count !== undefined ? (
        <span className="ml-auto pl-2 pr-0.5 text-[10.5px] tabular-nums text-[var(--muted)]">
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function SidebarDocumentActions({
  documentId,
  starred,
  onAction,
}: {
  documentId: string;
  starred: boolean;
  onAction: (documentId: string, action: DocumentAction) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <div
      className={cn(
        styles.actions,
        styles.documentActions,
        'ml-auto flex shrink-0 items-center gap-0.5',
      )}
      data-starred={starred ? 'true' : undefined}
    >
      <IconButton
        className={styles.actionButton}
        label={starred ? knowledgeT('removeDocumentFavorite') : knowledgeT('favoriteDocument')}
        onClick={() => onAction(documentId, 'toggle-star')}
      >
        <Star
          aria-hidden="true"
          size={14}
          weight={starred ? 'fill' : 'regular'}
          className={starred ? 'text-[#e5aa14]' : undefined}
        />
      </IconButton>
      <SidebarDocumentMenu documentId={documentId} starred={starred} onAction={onAction} />
    </div>
  );
}

export function RecentNoteRow({
  icon,
  documentId,
  label,
  selected,
  starred,
  onClick,
  onAction,
}: {
  documentId: string;
  label: string;
  icon?: string | null;
  selected?: boolean;
  starred?: boolean;
  onClick: () => void;
  onAction: (documentId: string, action: DocumentAction) => void;
}) {
  return (
    <div
      data-selected={selected ? 'true' : undefined}
      className={cn(
        styles.row,
        'group flex h-[28px] w-full items-center rounded-[6px] pl-[22px] pr-1 text-left text-[12px] leading-none tracking-[-0.005em] text-muted-foreground outline-none',
        selected && 'font-medium text-foreground',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex h-full min-w-0 flex-1 items-center text-left outline-none"
      >
        <PageIcon value={icon} size={15} className={sidebarDocumentIconClass} />
        <span className={styles.documentLabel} title={label}>
          {label}
        </span>
      </button>
      <SidebarDocumentActions
        documentId={documentId}
        starred={Boolean(starred)}
        onAction={onAction}
      />
    </div>
  );
}

export function ProjectGlyph({
  iconId,
  className,
}: {
  iconId?: ProjectIconId;
  className?: string;
}) {
  if (!iconId || iconId === 'folder') return <Folder aria-hidden size={15} weight="fill" className={cn('mr-2 shrink-0 text-[var(--sidebar-icon)]', className)} />;
  return (
    <ProjectIcon iconId={iconId} className={cn('mr-2 size-[15px] rounded-[4px]', className)} />
  );
}
