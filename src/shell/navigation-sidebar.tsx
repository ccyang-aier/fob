'use client';

import { GearSix, SidebarSimple } from '@phosphor-icons/react';
import { AccountItem } from '@/features/identity/components/account-item';
import { ProjectSwitcher } from '@/features/project/project-switcher';
import { NavButton, type SidebarRowItem } from '@/components/nav-button';
import { SidebarResizeHandle, useSidebarWidth } from '@/components/sidebar-resize';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WorkbenchView } from './workbench-view';
import { messages } from './i18n/navigation-sidebar.messages';
import { SidebarThemeSwitch } from './sidebar-theme-switch';
import { workbenchPages, type WorkbenchPage } from './workbench-pages';
import styles from './sidebar-footer.module.css';
import layout from './navigation-sidebar.module.css';

export function NavigationSidebar({ open, onCollapse, onExpand, view, onViewChange, onProjectChange }: {
  open: boolean; onCollapse: () => void; onExpand: () => void;
  view: WorkbenchView; onViewChange: (view: WorkbenchView) => void;
  onProjectChange: () => void;
}) {
  const { t } = useTranslation(messages);
  const { width, dragging, startResize } = useSidebarWidth(272);
  const primary: WorkbenchPage[] = ['knowledge', 'members'];
  function row(id: WorkbenchPage) {
    const page = workbenchPages[id];
    const item: SidebarRowItem & { id: WorkbenchPage } = { id, label: t(page.label), icon: page.icon };
    const button = <NavButton item={item} active={view === item.id} compact={!open} onSelect={() => onViewChange(item.id)} />;
    return open ? <div key={item.id}>{button}</div> : <Tooltip key={item.id}><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right" sideOffset={10}>{item.label}</TooltipContent></Tooltip>;
  }
  return <aside aria-label={t(open ? '主导航' : '主导航（已收起）')} style={{ width: open ? width : 52 }} className={cn('sidebar-material relative flex h-full shrink-0 flex-col', !dragging && 'transition-[width] duration-200 ease-out')}>
    <header className={layout.header} data-compact={!open}>
      {open && <div className={layout.project}><ProjectSwitcher onSwitch={onProjectChange} /></div>}
      <Tooltip>
        <TooltipTrigger asChild><button type="button" className={`fob-action ${layout.toggle}`} aria-label={t(open ? '收起主导航' : '展开主导航')} onClick={open ? onCollapse : onExpand}><SidebarSimple size={18} weight="duotone" /></button></TooltipTrigger>
        <TooltipContent side="bottom">{t(open ? '收起主导航' : '展开主导航')}</TooltipContent>
      </Tooltip>
    </header>
    <ScrollArea className="min-h-0 flex-1" viewportClassName={open ? 'px-3 pb-4 pt-2' : 'px-1 pb-3 pt-2'}>
      <nav aria-label={t('项目导航')} className="flex flex-col gap-0.5">{primary.map(row)}</nav>
    </ScrollArea>
    <footer className={cn('flex shrink-0 flex-col gap-0.5 pt-2', open ? 'px-3' : 'px-1')}>
      <div className={styles.dock} data-compact={!open}>
        <div className={styles.account}><AccountItem compact={!open} /></div>
        {open && <><SidebarThemeSwitch />
        <Tooltip>
          <TooltipTrigger asChild><button type="button" className={`fob-action ${styles.iconButton}`} aria-label={t('设置')} aria-haspopup="dialog" onClick={() => onViewChange('settings')}><GearSix size={18} weight="duotone" aria-hidden /></button></TooltipTrigger>
          <TooltipContent side="top">{t('设置')}</TooltipContent>
        </Tooltip></>}
      </div>
    </footer>
    {open && <SidebarResizeHandle className={layout.resizeHandle} dragging={dragging} onPointerDown={startResize} />}
  </aside>;
}
