'use client';

import { GearSix } from '@phosphor-icons/react';
import { RewardsCard } from '@/features/rewards';
import { KnowledgeBaseSwitcher } from '@/features/knowledge/knowledge-base-switcher';
import { KnowledgeNavigationOutlet } from '@/features/knowledge/navigation/system-navigation';
import { NavButton, type SidebarRowItem } from '@/components/nav-button';
import { SidebarResizeHandle, useSidebarWidth } from '@/components/sidebar-resize';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WorkbenchView } from './workbench-view';
import { messages } from './i18n/navigation-sidebar.messages';
import { SidebarHelp } from './sidebar-help';
import { workbenchPages, type WorkbenchPage } from './workbench-pages';
import styles from './sidebar-footer.module.css';
import layout from './navigation-sidebar.module.css';

export function NavigationSidebar({ open, onCollapse, onExpand, view, onViewChange, onKnowledgeBaseChange }: {
  open: boolean; onCollapse: () => void; onExpand: () => void;
  view: WorkbenchView; onViewChange: (view: WorkbenchView) => void;
  onKnowledgeBaseChange: () => void;
}) {
  const { t } = useTranslation(messages);
  const { width, dragging, startResize } = useSidebarWidth(272);
  function row(id: WorkbenchPage) {
    const page = workbenchPages[id];
    const item: SidebarRowItem & { id: WorkbenchPage } = { id, label: t(page.label), icon: page.icon };
    const button = <NavButton item={item} active={view === item.id} compact={!open} onSelect={() => onViewChange(item.id)} />;
    return open ? <div key={item.id}>{button}</div> : <Tooltip key={item.id}><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right" sideOffset={10}>{item.label}</TooltipContent></Tooltip>;
  }
  const settingsButton = <Tooltip>
    <TooltipTrigger asChild><button type="button" className={cn('fob-action', styles.settings, !open && styles.iconButton)} aria-label={t('设置')} aria-haspopup="dialog" onClick={() => onViewChange('settings')}><GearSix size={18} weight="regular" aria-hidden />{open && <span>{t('设置')}</span>}</button></TooltipTrigger>
    <TooltipContent side={open ? 'top' : 'right'}>{t('设置')}</TooltipContent>
  </Tooltip>;
  const helpButton = <SidebarHelp compact={!open} onNavigate={onViewChange} />;
  return <aside aria-label={t(open ? '主导航' : '主导航（已收起）')} style={{ width: open ? width : 52 }} className={cn('sidebar-material relative flex h-full shrink-0 flex-col', !dragging && 'transition-[width] duration-200 ease-out')}>
    <header className={layout.header} data-compact={!open}>
      {open && <div className={layout.switcher}><KnowledgeBaseSwitcher onSwitch={onKnowledgeBaseChange} /></div>}
      <Tooltip>
        <TooltipTrigger asChild><button type="button" className={`fob-action ${layout.toggle}`} aria-label={t(open ? '收起主导航' : '展开主导航')} onClick={open ? onCollapse : onExpand}>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="3" width="3.5" height="10" rx="1.25" fill="currentColor" opacity="0.55" />
            <rect x="6.5" y="3" width="7.5" height="10" rx="1.5" fill="currentColor" />
          </svg>
        </button></TooltipTrigger>
        <TooltipContent side="bottom">{t(open ? '收起主导航' : '展开主导航')}</TooltipContent>
      </Tooltip>
    </header>
    <KnowledgeNavigationOutlet compact={!open} />
    <footer className={cn(styles.footer, open ? 'px-3' : 'px-1')}>
      <nav aria-label={t('知识库导航')} className={styles.utilityNavigation}>{row('members')}{row('templates')}</nav>
      <div className={styles.dock} data-compact={!open}>
        {open ? <>{settingsButton}{helpButton}</> : <>{helpButton}{settingsButton}</>}
      </div>
      {open && <div className={styles.rewards}><RewardsCard onOpen={() => onViewChange('rewards')} /></div>}
    </footer>
    {open && <SidebarResizeHandle className={layout.resizeHandle} dragging={dragging} onPointerDown={startResize} />}
  </aside>;
}
