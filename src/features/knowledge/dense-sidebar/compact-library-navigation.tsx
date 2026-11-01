'use client';

import { Folder } from '@/components/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageIcon } from '../navigation/page-icon';
import { KnowledgeMainNavigation } from './knowledge-main-navigation';
import { SidebarRow } from './sidebar-navigation-primitives';
import { useI18n } from './use-i18n';

export function CompactLibraryNavigation({ activeItem, counts, folders, selectedFolderId, onNavigate, onSelectFolder }: {
  activeItem: string | null;
  counts: Record<string, number>;
  folders: { id: string; label: string; icon?: string | null }[];
  selectedFolderId?: string | null;
  onNavigate: (id: string) => void;
  onSelectFolder: (id: string) => void;
}) {
  const { t } = useI18n();
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0"><KnowledgeMainNavigation compact activeItem={activeItem} counts={counts} onNavigate={onNavigate} /></div>
    {folders.length > 0 && <>
      <div role="separator" className="mx-auto mb-2 h-[var(--separator-width)] w-6 shrink-0 bg-[var(--separator-color)]" />
      <nav aria-label={t('sidebar.projects')} className="scrollbar-hidden grid min-h-0 auto-rows-[32px] content-start gap-1 overflow-y-auto pb-2">
        {folders.map(folder => <Tooltip key={folder.id}>
          <TooltipTrigger asChild><SidebarRow
            iconOnly
            label={folder.label}
            icon={Folder}
            leading={folder.icon ? <PageIcon value={folder.icon} size={14} /> : undefined}
            selected={selectedFolderId === folder.id}
            onClick={() => onSelectFolder(folder.id)}
          /></TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>{folder.label}</TooltipContent>
        </Tooltip>)}
      </nav>
    </>}
  </div>;
}
