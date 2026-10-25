'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpenText, Keyboard, Question, SquaresFour, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { defineMessages, useTranslation } from '@/lib/i18n';
import type { WorkbenchView } from './workbench-view';
import styles from './sidebar-footer.module.css';
import help from './sidebar-help.module.css';

const messages = defineMessages({
  help: ['帮助', 'Help'], title: ['Fob 使用指南', 'Fob guide'], close: ['关闭帮助', 'Close help'],
  knowledgeBase: ['切换与管理知识库', 'Switch and manage knowledge bases'],
  knowledgeBaseHint: ['顶部菜单可创建、切换知识库。文档、成员和权限始终属于当前知识库。', 'Use the top menu to create or switch knowledge bases. Documents, members and permissions belong to the selected knowledge base.'],
  search: ['搜索当前知识库', 'Search this knowledge base'],
  searchHint: ['使用顶栏搜索查找文档标题和正文。', 'Find document titles and content using search in the top bar.'],
  storage: ['本地与团队知识库', 'Local and team knowledge bases'],
  storageHint: ['本地内容保存在当前浏览器，清理浏览器数据会删除内容，请及时导出备份。团队知识库通过登录账户与成员权限共享。', 'Local content stays in this browser. Clearing browser data deletes it, so export a backup regularly. Team knowledge bases use accounts and member permissions for sharing.'],
  openKnowledge: ['打开知识库', 'Open knowledge'], templates: ['浏览模板', 'Browse templates'],
});

export function SidebarHelp({ compact, onNavigate }: { compact: boolean; onNavigate: (view: WorkbenchView) => void }) {
  const { t } = useTranslation(messages);
  const [open, setOpen] = useState(false);
  return <>
    <Tooltip><TooltipTrigger asChild><button type="button" className={`fob-action ${compact ? styles.iconButton : styles.settings}`} aria-label={t('help')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Question size={18} weight="fill" aria-hidden />{!compact && <span>{t('help')}</span>}</button></TooltipTrigger><TooltipContent side={compact ? 'right' : 'top'}>{t('help')}</TooltipContent></Tooltip>
    {open && <HelpDialog onClose={() => setOpen(false)} onNavigate={onNavigate} />}
  </>;
}

function HelpDialog({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: WorkbenchView) => void }) {
  const { t } = useTranslation(messages);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  function navigate(view: WorkbenchView) { onClose(); onNavigate(view); }
  return <dialog ref={dialogRef} className={help.dialog} aria-labelledby="fob-help-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={help.content}>
      <header className={help.header}><h2 id="fob-help-title">{t('title')}</h2><button type="button" className={`fob-action ${help.close}`} aria-label={t('close')} onClick={onClose}><X weight="bold" size={15} aria-hidden /></button></header>
      <div className={help.guide}>
        <section><BookOpenText size={18} aria-hidden /><div><h3>{t('knowledgeBase')}</h3><p>{t('knowledgeBaseHint')}</p></div></section>
        <section><Keyboard size={18} aria-hidden /><div><h3>{t('search')}<kbd>Ctrl / ⌘ K</kbd></h3><p>{t('searchHint')}</p></div></section>
        <section><SquaresFour size={18} aria-hidden /><div><h3>{t('storage')}</h3><p>{t('storageHint')}</p></div></section>
      </div>
      <footer className={help.footer}><Button variant="outline" onClick={() => navigate('templates')}>{t('templates')}</Button><Button onClick={() => navigate('knowledge')}>{t('openKnowledge')}</Button></footer>
    </div>
  </dialog>;
}
