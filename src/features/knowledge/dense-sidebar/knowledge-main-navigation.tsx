'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SIDEBAR_MAIN_ITEMS } from './sidebar-navigation';
import { SidebarRow, sidebarIconMap } from './sidebar-navigation-primitives';
import { useI18n } from './use-i18n';

export function KnowledgeMainNavigation({ activeItem, counts, compact = false, onNavigate }: {
  activeItem: string | null;
  counts: Record<string, number>;
  compact?: boolean;
  onNavigate: (id: string) => void;
}) {
  const { t } = useI18n();
  return <nav aria-label={t('sidebar.library')} className={compact ? 'flex flex-col items-center gap-1 py-2' : 'space-y-0.5'}>
    {SIDEBAR_MAIN_ITEMS.map(item => {
      const label = t(item.labelKey);
      const button = <SidebarRow label={label} icon={sidebarIconMap[item.icon]} iconTone={item.tone} iconOnly={compact} count={counts[item.id] ?? 0} selected={activeItem === item.id} onClick={() => onNavigate(item.id)} />;
      return compact
        ? <Tooltip key={item.id}><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right" sideOffset={10}>{label}</TooltipContent></Tooltip>
        : <div key={item.id}>{button}</div>;
    })}
  </nav>;
}
