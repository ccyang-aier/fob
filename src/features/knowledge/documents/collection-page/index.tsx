'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowCounterClockwise, CaretDown, Desktop, FileDashed, FileText, MagnifyingGlass, Plus, SortAscending, SortDescending, Star, Trash, X } from '@/components/icons';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/lib/i18n';
import { usePageScrollKey, usePageSessionState } from '@/lib/page-session-state';
import { SIDEBAR_MAIN_ITEMS, sidebarIconToneClasses } from '../../dense-sidebar/sidebar-navigation';
import { DocumentListIcon } from '../document-list-icon';
import { documentRelativeTime } from '../document-relative-time';
import { collectionFolderPath, collectionRows, type CollectionEntry, type CollectionFolder, type CollectionKind, type CollectionSort } from './model';
import { messages } from './messages';
import folderStyles from '../../discovery/discovery.module.css';
import styles from './styles.module.css';

export type CollectionPageProps = {
  title: string;
  kind: CollectionKind;
  entries: readonly CollectionEntry[];
  folders: readonly CollectionFolder[];
  onOpen(id: string): void;
  onCreate?(): void;
  onRemove?(id: string): void;
  renderActions?(id: string): ReactNode;
  dateKind?: 'updated' | 'deleted';
  loading?: boolean;
  error?: ReactNode;
  notice?: ReactNode;
  footer?: string;
};

export function DocumentCollectionPage({ title, kind, entries, folders, onOpen, onCreate, onRemove, renderActions, dateKind = 'updated', loading = false, error, notice, footer }: CollectionPageProps) {
  const { t, locale } = useTranslation(messages);
  const [search, setSearch] = usePageSessionState(`collection.${kind}.search`, '');
  const [sort, setSort] = usePageSessionState<CollectionSort>(`collection.${kind}.sort`, 'newest');
  const [location, setLocation] = usePageSessionState(`collection.${kind}.location`, 'all');
  const [limit, setLimit] = useState(24);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const scrollKey = usePageScrollKey(`collection:${kind}`);
  const places = folders.filter(folder => entries.some(entry => entry.folderId === folder.id)).map(folder => ({ ...folder, path: collectionFolderPath(folder.id, folders, t('unfiled')) }));
  const activeLocation = places.some(folder => folder.id === location) || location === 'unfiled' ? location : 'all';
  const rows = useMemo(() => collectionRows(entries, folders, search, sort, locale, t('unfiled')).filter(entry => activeLocation === 'all' || (activeLocation === 'unfiled' ? !entry.folderId : entry.folderId === activeLocation)), [entries, folders, search, sort, locale, t, activeLocation]);
  const shown = rows.slice(0, limit);
  const HeaderIcon = kind === 'starred' ? Star : kind === 'drafts' ? FileDashed : kind === 'trash' ? Trash : FileText;
  const headerTone = SIDEBAR_MAIN_ITEMS.find(item => item.id === kind)?.tone;
  const emptyLabel = kind === 'starred' ? t('emptyStarred') : kind === 'drafts' ? t('emptyDrafts') : kind === 'trash' ? t('emptyTrash') : t('emptyDocuments');
  const emptyHint = kind === 'starred' ? t('starredHint') : kind === 'drafts' ? t('draftsHint') : kind === 'trash' ? t('trashHint') : undefined;
  const filtered = Boolean(search.trim() || activeLocation !== 'all');
  const sortLabel = (value: CollectionSort) => t(dateKind === 'deleted' && value !== 'title' ? value === 'newest' ? 'newestDeleted' : 'oldestDeleted' : value);
  const locations = [{ id: 'all', name: t('allDocuments'), path: t('allDocuments') }, ...places, ...(entries.some(entry => !entry.folderId) ? [{ id: 'unfiled', name: t('unfiled'), path: t('unfiled') }] : [])];
  function reset() { setSearch(''); setLocation('all'); setLimit(24); }

  return <section className={`${folderStyles.folder} ${styles.page}`} aria-label={title} aria-busy={loading} data-collection={kind} data-page-scroll={scrollKey}>
    <div className={folderStyles.folderToolbar}>
      <label><MagnifyingGlass size={14} /><input type="search" aria-label={t('search')} placeholder={t('searchPlaceholder')} value={search} onChange={event => { setSearch(event.target.value); setLimit(24); }} disabled={loading} />{search && <button type="button" className={`fob-action ${styles.clearSearch}`} aria-label={t('clearSearch')} onClick={() => { setSearch(''); setLimit(24); }}><X size={14} /></button>}</label>
      {onCreate && kind !== 'trash' && <div className={folderStyles.folderActions}><Button size="sm" variant="outline" onClick={onCreate}><Plus size="18px" />{t('newDocument')}</Button></div>}
    </div>
    <div className={folderStyles.folderFrame}><div className={folderStyles.folderContent}>
      <header className={folderStyles.folderHeader}>
        <div className={folderStyles.folderTitle}><span className={folderStyles.folderGlyph} aria-hidden="true"><HeaderIcon size={36} className={headerTone ? sidebarIconToneClasses[headerTone] : undefined} /></span><h1>{title}</h1></div>
        <p className={folderStyles.meta}>{loading ? t('loading') : !error && t('documentCount', { count: entries.length })}</p>
      </header>
      <div className={folderStyles.tabBar}>
        <nav className={folderStyles.tabs} aria-label={t('location')}>
          {locations.map(place => <button key={place.id} type="button" className={`${folderStyles.tab} ${styles.location}`} title={place.path} aria-pressed={activeLocation === place.id} onClick={() => { setLocation(place.id); setLimit(24); }}>{place.name}{activeLocation === place.id && <span className={folderStyles.tabIndicator} />}</button>)}
        </nav>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className={folderStyles.sortControl} aria-label={t('sort')} title={sortLabel(sort)}>{sort === 'newest' ? <SortDescending size={16} /> : <SortAscending size={16} />}<span>{sortLabel(sort)}</span><CaretDown size={12} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={sort} onValueChange={value => { setSort(value as CollectionSort); setLimit(24); }}>{(['newest', 'oldest', 'title'] as const).map(value => <DropdownMenuRadioItem key={value} value={value}>{sortLabel(value)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
        </DropdownMenu>
      </div>
      {notice}
      {kind === 'trash' && entries.length > 0 && <p className={styles.notice}><ArrowCounterClockwise size={14} />{t('trashNotice')}</p>}
      {filtered && !loading && !error && <span className="sr-only" role="status">{t('results', { count: rows.length })}</span>}
      {error ? <div className={styles.feedback}>{error}</div> : loading ? <div role="status" aria-label={t('loading')}>{[0, 1, 2].map(value => <div key={value} className={`${folderStyles.documentRow} ${styles.skeleton}`} aria-hidden="true"><span /><div><i /><i /></div></div>)}</div> : rows.length ? <>
        <ul className={folderStyles.list}>
          {shown.map(entry => {
            const meta = <span className={`${folderStyles.documentMeta} ${styles.documentMeta}`}><span title={entry.folder}>{entry.folder}</span>{entry.creator && <span> · {entry.creator}</span>}{entry.date && Number.isFinite(Date.parse(entry.date)) && <span><span className={folderStyles.metaSeparator}>•</span>{t(dateKind)} <time dateTime={entry.date} title={new Date(entry.date).toLocaleString(locale)}>{documentRelativeTime(entry.date, now, locale, t('lessThanMinute'))}</time></span>}</span>;
            return <li key={entry.id} className={`fob-action ${folderStyles.documentRow} ${styles.row}`} data-document-id={entry.id}>
              <span className={`${folderStyles.documentGlyph} ${styles.glyph}`}><DocumentListIcon value={entry.icon} /></span>
              <div className={folderStyles.documentText}>
                <div className={folderStyles.documentHeading}>
                  {kind === 'trash' ? <span className={`${folderStyles.openDocument} ${styles.deletedTitle}`}>{entry.title}</span> : <button type="button" className={folderStyles.openDocument} aria-label={entry.title} onClick={() => onOpen(entry.id)}>{entry.title}</button>}
                  {onRemove && <button type="button" className={`fob-action ${folderStyles.rowStar} ${styles.quick}`} data-starred={kind === 'starred' || undefined} data-variant="hover" aria-label={t(kind === 'starred' ? 'unstar' : 'removeDraft', { title: entry.title })} title={t(kind === 'starred' ? 'unstar' : 'removeDraft', { title: entry.title })} onClick={() => onRemove(entry.id)}>{kind === 'starred' ? <Star size={18} /> : <FileDashed size={16} />}</button>}
                </div>
                {kind === 'trash' ? meta : <button type="button" className={folderStyles.openMeta} tabIndex={-1} onClick={() => onOpen(entry.id)}>{meta}</button>}
              </div>
              <div className={`${folderStyles.rowActions} ${styles.rowActions}`} data-persistent={kind === 'trash' || undefined}>{renderActions?.(entry.id)}</div>
            </li>;
          })}
        </ul>
        {rows.length > shown.length && <div className={folderStyles.loadMore}><Button variant="ghost" size="sm" onClick={() => setLimit(current => current + 24)}>{t('showMore')}</Button></div>}
      </> : <EmptyState label={filtered ? t('noResults') : emptyLabel} description={filtered ? t('noResultsHint') : emptyHint} actions={filtered ? <Button size="sm" variant="outline" onClick={reset}>{t('clearSearch')}</Button> : onCreate && kind !== 'trash' ? <Button size="sm" variant="outline" onClick={onCreate}><Plus size={14} />{t('newDocument')}</Button> : undefined} />}
      {footer && <p className={styles.footer}><Desktop size={14} />{footer}</p>}
    </div></div>
  </section>;
}
