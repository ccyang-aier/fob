'use client';

import { DotsThree, PencilSimple, PushPin, PushPinSlash, Trash } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { messages } from './i18n/navigation-sidebar.messages';
import styles from './sidebar-sections.module.css';

export function SidebarEntryRow({ name, label, icon, pinned, onOpen, onPin, onRename, onDelete }: {
  name: string; label?: string; icon: ReactNode; pinned?: boolean;
  onOpen: () => void; onPin: () => void; onRename: () => void; onDelete: () => void;
}) {
  const { t } = useTranslation(messages);
  const [menuOpen, setMenuOpen] = useState(false);
  const pinLabel = t(pinned ? '取消置顶名称' : '置顶名称', { name });
  const PinIcon = pinned ? PushPinSlash : PushPin;
  return <div className={`sidebar-nav-row ${styles.row}`} data-menu-open={menuOpen}>
    <button type="button" className={styles.entry} onClick={onOpen} aria-label={label} title={name}>{icon}<span>{name}</span></button>
    <div className={styles.rowActions}>
      <Tooltip><TooltipTrigger asChild><button type="button" className={`fob-action ${styles.action}`} data-variant="nested" aria-label={pinLabel} aria-pressed={Boolean(pinned)} onClick={onPin}><PinIcon size={14} weight="duotone" aria-hidden /></button></TooltipTrigger><TooltipContent side="top">{t(pinned ? '取消置顶' : '置顶')}</TooltipContent></Tooltip>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger className={styles.action} data-variant="nested" aria-label={t('条目更多操作', { name })}><DotsThree size={17} weight="bold" aria-hidden /></DropdownMenuTrigger>
        {menuOpen && <DropdownMenuContent side="right" align="start" density="compact"><DropdownMenuGroup>
          <DropdownMenuItem onSelect={onRename}><PencilSimple weight="duotone" />{t('重命名')}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash weight="duotone" />{t('删除')}</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>}
      </DropdownMenu>
    </div>
  </div>;
}
