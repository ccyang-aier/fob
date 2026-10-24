'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MagnifyingGlass, Tag, TreeStructure, UserPlus, UsersThree, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSearch, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { EmptyState } from '@/components/empty-state';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { usePageVisible } from '@/lib/page-visibility';
import { usePageSessionState } from '@/lib/page-session-state';
import { useProjectResources } from '../project-resources';
import { MemberCollection } from './member-collection';
import { MemberDialog } from './member-dialogs';
import { referenceMembers, type DirectoryMember } from './members.data';
import { messages } from './members.messages';
import styles from './members.module.css';

const tabs = ['members', 'structure'] as const;
export function ProjectMembersPage() {
  const { scopeKey } = useProjectResources();
  return <MembersPreview key={scopeKey ?? 'reference'} />;
}

function MembersPreview() {
  const { t, locale } = useTranslation(messages);
  const { notify } = useAppAlert();
  const visible = usePageVisible();
  const searchInput = useRef<HTMLInputElement>(null);
  const tabsId = useId();
  const [members, setMembers] = usePageSessionState<DirectoryMember[]>('members-directory:directory', referenceMembers);
  const [tab, setTab] = usePageSessionState<typeof tabs[number]>('members-directory:tab', 'members');
  const [mode, setMode] = usePageSessionState<'grid' | 'list'>('members-directory:view', 'grid');
  const [search, setSearch] = usePageSessionState('members-directory:search', '');
  const [label, setLabel] = usePageSessionState<string | null>('members-directory:label', null);
  const [labelSearch, setLabelSearch] = useState('');
  const [panel, setPanel] = useState<{ id?: string } | null>(null);
  const departments = [...new Set(members.map(member => member.department).filter(Boolean))];
  const labels = [...new Set(members.flatMap(member => member.labels.map(label => label.name)))];
  const activeLabel = label && labels.includes(label) ? label : null;
  const term = search.trim().toLocaleLowerCase();
  const matching = members.filter(member =>
    (!activeLabel || member.labels.some(label => label.name === activeLabel)) &&
    [member.name, member.email, member.position, member.department, ...member.labels.map(label => label.name)].some(value => value.toLocaleLowerCase().includes(term)));
  const selected = members.find(member => member.id === panel?.id);
  const filteredLabels = labels.filter(name => name.toLocaleLowerCase().includes(labelSearch.trim().toLocaleLowerCase()));
  const filtered = Boolean(term || activeLabel);
  useEffect(() => {
    if (!visible || panel || tab !== 'members') return;
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); searchInput.current?.focus(); }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [visible, panel, tab]);

  function save(member: DirectoryMember) {
    const exists = members.some(item => item.id === member.id);
    updateDirectory(exists ? members.map(item => item.id === member.id ? member : item) : [...members, member]);
    notify('success', t(exists ? 'saved' : 'added'));
  }
  function updateDirectory(next: DirectoryMember[]) {
    setMembers(next);
    if (label && !next.some(member => member.labels.some(item => item.name === label))) setLabel(null);
  }
  return <section className={styles.page} aria-label={t('title')} lang={locale}>
    <header className={styles.header}><h1>{t('title')}</h1>
      {tab === 'members' && <Button size="sm" onClick={() => setPanel({})}><UserPlus size={16} />{t('add')}</Button>}
    </header>
    <div className={styles.tabs} role="tablist" aria-label={t('title')}>{tabs.map(value => {
      const Icon = value === 'members' ? UsersThree : TreeStructure;
      return <button key={value} id={`${tabsId}-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${tabsId}-content`}
        tabIndex={tab === value ? 0 : -1} className={`fob-action ${styles.tab}`} onClick={() => setTab(value)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'members' : event.key === 'End' ? 'structure' : value === 'members' ? 'structure' : 'members';
          setTab(next); document.getElementById(`${tabsId}-${next}`)?.focus();
        }}><Icon size={16} />{t(value)}</button>;
    })}</div>
    <div role="tabpanel" id={`${tabsId}-content`} aria-labelledby={`${tabsId}-${tab}`}>
      {tab === 'structure' ? <EmptyState className={styles.structureEmpty} label={t('comingSoon')} /> : <>
        <div className={styles.toolbar}>
          <span className={styles.memberCount} aria-live="polite">{t('count', { count: matching.length })}</span>
          <div className={styles.tools}>
            <div className={styles.search}><MagnifyingGlass size={16} aria-hidden /><input ref={searchInput} type="search" aria-label={t('search')} placeholder={t('searchPlaceholder')} value={search} onChange={event => setSearch(event.target.value)} />
              {search && <button type="button" className="fob-action" aria-label={t('clearSearch')} onClick={() => { setSearch(''); searchInput.current?.focus(); }}><X size={12} /></button>}
            </div>
            <DropdownMenu onOpenChange={() => setLabelSearch('')}>
              <DropdownMenuTrigger className={styles.filter} data-surface="plain" data-active={Boolean(activeLabel) || undefined} aria-label={t('labels')}>
                <Tag size={16} /><span>{activeLabel ? t('filterLabel', { name: activeLabel }) : t('labels')}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" density="compact" className={styles.labelMenu}>
                <DropdownMenuSearch value={labelSearch} onValueChange={setLabelSearch} placeholder={t('searchLabels')} clearLabel={t('clearSearch')} />
                <DropdownMenuRadioGroup value={activeLabel ?? ''} onValueChange={value => setLabel(value || null)}>
                  <DropdownMenuRadioItem value="" indicator="none" emphasizeSelection={false}>{t('allLabels')}</DropdownMenuRadioItem>
                  {filteredLabels.map(name => <DropdownMenuRadioItem key={name} value={name} indicator="none"><Tag size={14} />{name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
                {!filteredLabels.length && <p className={styles.menuEmpty}>{t('noLabelsFound')}</p>}
              </DropdownMenuContent>
            </DropdownMenu>
            <ViewSwitcher value={mode} onValueChange={setMode} listLabel={t('list')} gridLabel={t('grid')} />
          </div>
        </div>
        {filtered && <div className={styles.activeFilters}>
          {activeLabel && <button type="button" className="fob-action" onClick={() => setLabel(null)} aria-label={t('clearLabelFilter', { name: activeLabel })}><Tag size={13} /><span>{activeLabel}</span><X size={12} /></button>}
          <button type="button" className={`fob-action ${styles.clearFilters}`} onClick={() => { setSearch(''); setLabel(null); }}>{t('clearFilters')}</button>
        </div>}
        {matching.length > 0 ? <MemberCollection members={matching} mode={mode} onOpen={member => setPanel({ id: member.id })} /> : <EmptyState className={styles.directoryEmpty} label={t(filtered ? 'noMatches' : 'empty')} />}
      </>}
    </div>
    {panel && <MemberDialog key={panel.id ?? 'new'} member={selected} departments={departments} labels={labels} onClose={() => setPanel(null)} onSave={save}
      onRemove={id => { updateDirectory(members.filter(member => member.id !== id)); notify('success', t('removed')); }} />}
  </section>;
}
