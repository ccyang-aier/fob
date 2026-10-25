'use client';

import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsClockwise, CopySimple, PushPin, PushPinSlash, Tabs, X, XSquare, SplitHorizontal, Square } from '@/components/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getOverlayRoot } from '@/lib/overlay-root';
import { useTranslation } from '@/lib/i18n';
import { newWorkbenchPages, type TabAction } from './workbench-tabs';
import { workbenchPages, type WorkbenchPage } from './workbench-pages';
import { messages } from './i18n/navigation-sidebar.messages';
import styles from './workbench-tab-bar.module.css';

type ContextMenuProps = { point: { x: number; y: number }; onClose: () => void; onReturnFocus: () => void };

function TabContextMenu({ point, label, onClose, onReturnFocus, children }: ContextMenuProps & { label: string; children: ReactNode }) {
  const returnFocus = useRef(true);
  return <DropdownMenu open modal={false} onOpenChange={open => { if (!open) onClose(); }}>
    {createPortal(<DropdownMenuTrigger aria-hidden tabIndex={-1} className={styles.contextAnchor} style={{ left: point.x, top: point.y }} />, getOverlayRoot() ?? document.body)}
    <DropdownMenuContent aria-label={label} className={styles.menu} side="bottom" align="start" sideOffset={4} collisionPadding={8}
      onInteractOutside={() => { returnFocus.current = false; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current) onReturnFocus(); }}>
      {children}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function WorkbenchTabMenu({ pinned, hasOthers, canSplit, inSplit, onAction, ...props }: ContextMenuProps & {
  pinned: boolean; hasOthers: boolean; canSplit?: boolean; inSplit?: boolean; onAction: (action: TabAction) => void;
}) {
  const { t } = useTranslation(messages);
  const PinIcon = pinned ? PushPinSlash : PushPin;
  return <TabContextMenu {...props} label={t('页签操作')}>
    <DropdownMenuItem className={styles.menuItem} onSelect={() => onAction('pin')}><PinIcon aria-hidden />{t(pinned ? '取消置顶' : '置顶')}</DropdownMenuItem>
    <DropdownMenuItem className={styles.menuItem} onSelect={() => onAction('reload')}><ArrowsClockwise aria-hidden />{t('重新加载')}</DropdownMenuItem>
    <DropdownMenuItem className={styles.menuItem} onSelect={() => onAction('duplicate')}><CopySimple aria-hidden />{t('复制标签页')}</DropdownMenuItem>
    {canSplit && <DropdownMenuItem className={styles.menuItem} onSelect={() => onAction(inSplit ? 'unsplit' : 'split')}>{inSplit ? <Square aria-hidden /> : <SplitHorizontal aria-hidden />}{t(inSplit ? '结束拆分' : '在拆分视图打开')}</DropdownMenuItem>}
    <DropdownMenuSeparator className={styles.menuSeparator} />
    <DropdownMenuItem className={styles.menuItem} onSelect={() => onAction('current')}><X aria-hidden />{t('关闭')}</DropdownMenuItem>
    <DropdownMenuItem className={styles.menuItem} disabled={!hasOthers} onSelect={() => onAction('others')}><Tabs aria-hidden />{t('关闭其它标签页')}</DropdownMenuItem>
    <DropdownMenuItem className={styles.menuItem} onSelect={() => onAction('all')}><XSquare aria-hidden />{t('关闭全部标签页')}</DropdownMenuItem>
  </TabContextMenu>;
}

export function WorkbenchNewTabMenu({ onNew, ...props }: ContextMenuProps & { onNew: (page: WorkbenchPage) => void }) {
  const { t } = useTranslation(messages);
  return <TabContextMenu {...props} label={t('新建标签页')}>
    {newWorkbenchPages.map(view => {
      const page = workbenchPages[view];
      const Icon = page.icon;
      return <DropdownMenuItem key={view} className={styles.menuItem} onSelect={() => onNew(view)}><Icon aria-hidden />{t(page.label)}</DropdownMenuItem>;
    })}
  </TabContextMenu>;
}
