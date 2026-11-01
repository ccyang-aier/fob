'use client';

import { useState } from 'react';
import type { ProfileResource } from '@fob/shared/knowledge/contracts';
import { ArrowRight, FileText, Folder, DotsThree, Star, StarOutline, MagnifyingGlass } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SubscriptionMenuItem } from '@/features/knowledge/subscriptions/subscription-menu-item';
import { PageIcon } from '@/features/knowledge/navigation/page-icon';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import { profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import styles from './profile.module.css';

export type ProfileResourceActions = {
  onOpen: (resource: Pick<ProfileResource, 'id' | 'kind'>) => void;
  onToggleStar: (resource: ProfileResource) => void;
  knowledgeBaseId: string;
  source: 'local' | 'server';
};

export function ProfileResourceRow({ resource, compact = false, onOpen, onToggleStar, knowledgeBaseId, source }: ProfileResourceActions & { resource: ProfileResource; compact?: boolean }) {
  const { t, locale } = useTranslation(messages);
  const isFolder = resource.kind === 'folder';
  const updated = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'short', day: 'numeric' }).format(new Date(resource.updatedAt));
  return <div className={styles.resourceRow} data-compact={compact} data-folder={isFolder}>
    <button type="button" className={`fob-action ${styles.resourceMain}`} onClick={() => onOpen(resource)} aria-label={t(isFolder ? 'openFolder' : 'openDocument', { title: resource.title })}>
      <span className={styles.resourceIcon} data-folder={isFolder}>{resource.icon ? <PageIcon value={resource.icon} size={24} /> : isFolder ? <Folder size={26} aria-hidden /> : <FileText size={24} aria-hidden />}</span>
      <span className={styles.resourceText}><strong>{resource.title}</strong><span>{isFolder ? t('documentCount', { count: resource.count }) : <>{t('updated', { date: updated })}{!compact && resource.count > 0 ? <> · {t('readCount', { count: resource.count })}</> : null}</>}</span></span>
    </button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('resourceActions', { title: resource.title })}><DotsThree size={18} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => onOpen(resource)}>{isFolder ? <Folder size={16} /> : <FileText size={16} />}{t('open')}</DropdownMenuItem>
      {!isFolder ? <DropdownMenuItem onSelect={() => onToggleStar(resource)}>{resource.starred ? <Star size={16} /> : <StarOutline size={16} />}{t(resource.starred ? 'unsave' : 'save')}</DropdownMenuItem> : null}
      <SubscriptionMenuItem source={source} target={{ knowledgeBaseId, ...(isFolder ? { teamspaceId: resource.id } : { pageId: resource.id }) }} />
    </DropdownMenuContent></DropdownMenu>
  </div>;
}

export function ResourcePreview({ title, resources, limit, onMore, ...actions }: ProfileResourceActions & { title: string; resources: ProfileResource[]; limit: number; onMore: () => void }) {
  const { t } = useTranslation(messages);
  return <section className={styles.previewSection}>
    <div className={styles.sectionHeading}><h2>{title}</h2><Button variant="ghost" size="sm" className={styles.seeMore} onClick={onMore} aria-label={`${t('seeMore')} · ${title}`}>{t('seeMore')}<ArrowRight size={16} aria-hidden /></Button></div>
    {resources.length ? <div>{resources.slice(0,limit).map(resource => <ProfileResourceRow key={`${resource.kind}:${resource.id}`} resource={resource} {...actions} />)}</div> : <p className={styles.previewEmpty}>{t('emptyPreview')}</p>}
  </section>;
}

export function ProfileResourceList({ section, resources, nextOffset, onMore, loading, query, ...actions }: ProfileResourceActions & { section: 'documents' | 'folders' | 'saved'; resources: ProfileResource[]; nextOffset?: number | null; onMore?: () => void; loading?: boolean; query?: { q: string; sort: 'recent' | 'name'; onChange: (filter: { q: string; sort: 'recent' | 'name' }) => void } }) {
  const { t, locale } = useTranslation(messages);
  const [localSearch, setLocalSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [localSort, setLocalSort] = useState<'recent' | 'name'>('recent');
  const search = query?.q ?? localSearch, sort = query?.sort ?? localSort;
  const setSearch = (q: string) => query ? query.onChange({ q,sort }) : setLocalSearch(q);
  const setSort = (sort: 'recent' | 'name') => query ? query.onChange({ q: search,sort }) : setLocalSort(sort);
  const filtered = resources.filter(resource => resource.title.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale)) && (filter === 'all' || (filter === 'saved' ? resource.starred : resource.subscribed))).toSorted((a,b) => sort === 'name' ? a.title.localeCompare(b.title,locale) : b.updatedAt.localeCompare(a.updatedAt));
  const emptyTitle = section === 'documents' ? 'noDocuments' : section === 'folders' ? 'noFolders' : 'noSaved';
  const emptyHint = section === 'documents' ? 'noDocumentsHint' : section === 'folders' ? 'noFoldersHint' : 'noSavedHint';
  return <section className={styles.resourceList} aria-label={t(section)} aria-busy={loading}>
    <div className={styles.listToolbar}>
      {section === 'saved' ? <div className={styles.savedFilters} aria-label={t('saved')}>{(['all','saved','following'] as const).map(key => <Button key={key} variant="ghost" size="sm" aria-pressed={filter === key} data-active={filter === key} onClick={() => setFilter(key)}>{t(key === 'saved' ? 'onlySaved' : key === 'following' ? 'onlyFollowing' : 'all')}</Button>)}</div> : <h2>{t(section === 'documents' ? 'myDocuments' : 'myFolders')}<span className={styles.resultCount}>{resources.length}</span></h2>}
      <div className={styles.listControls}><label className={styles.search}><MagnifyingGlass size={15} aria-hidden /><input type="search" aria-label={t('search')} placeholder={t('search')} maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label={t('recent')} value={sort} onChange={event => setSort(event.target.value as 'recent' | 'name')}><option value="recent">{t('recent')}</option><option value="name">{t('name')}</option></select></div>
    </div>
    {filtered.length ? <div className={styles.fullResourceRows}>{filtered.map(resource => <ProfileResourceRow key={`${resource.kind}:${resource.id}`} resource={resource} {...actions} />)}</div> : loading ? <div className={styles.loading} role="status">{t('loading')}</div> : <EmptyState label={t(resources.length || search ? 'noResults' : emptyTitle)} description={t(resources.length || search ? 'noResultsHint' : emptyHint)} actions={resources.length || search ? <Button variant="outline" onClick={() => { setSearch(''); setFilter('all'); }}>{t('clear')}</Button> : undefined} />}
    {nextOffset != null && onMore ? <div className={styles.loadMore}><Button variant="outline" loading={loading} onClick={onMore}>{t('moreDocuments')}</Button></div> : null}
  </section>;
}
