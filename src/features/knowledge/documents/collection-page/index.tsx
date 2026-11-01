'use client';

import { useMemo, type ReactNode } from 'react';
import { ArrowsDownUp, ArrowCounterClockwise, CaretDown, Desktop, FileDashed, MagnifyingGlass, Plus, Star, X } from '@/components/icons';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatDate, useTranslation } from '@/lib/i18n';
import { usePageScrollKey, usePageSessionState } from '@/lib/page-session-state';
import { PageIcon } from '../../navigation/page-icon';
import { collectionRows, type CollectionEntry, type CollectionFolder, type CollectionKind, type CollectionSort } from './model';
import { messages } from './messages';
import styles from './styles.module.css';

export function DocumentCollectionPage({ title, kind, entries, folders, onOpen, onCreate, onRemove, renderActions, dateKind = 'updated', loading = false, error, notice, footer }: {
  title: string; kind: CollectionKind; entries: readonly CollectionEntry[]; folders: readonly CollectionFolder[];
  onOpen(id: string): void; onCreate?(): void; onRemove?(id: string): void; renderActions?(id: string): ReactNode;
  dateKind?: 'updated' | 'deleted'; loading?: boolean; error?: ReactNode; notice?: ReactNode; footer?: string;
}) {
  const { t, locale } = useTranslation(messages);
  const [search, setSearch] = usePageSessionState(`collection.${kind}.search`, '');
  const [sort, setSort] = usePageSessionState<CollectionSort>(`collection.${kind}.sort`, 'newest');
  const scrollKey = usePageScrollKey(`collection:${kind}`);
  const rows = useMemo(() => collectionRows(entries, folders, search, sort, locale, t('unfiled')), [entries, folders, search, sort, locale, t]);
  const emptyLabel = kind === 'starred' ? t('emptyStarred') : kind === 'drafts' ? t('emptyDrafts') : kind === 'trash' ? t('emptyTrash') : t('emptyDocuments');
  const emptyHint = kind === 'starred' ? t('starredHint') : kind === 'drafts' ? t('draftsHint') : kind === 'trash' ? t('trashHint') : undefined;
  const sortLabel = (value: CollectionSort) => t(dateKind === 'deleted' && value !== 'title' ? value === 'newest' ? 'newestDeleted' : 'oldestDeleted' : value);
  function content(entry: typeof rows[number]) {
    const validDate = entry.date && Number.isFinite(Date.parse(entry.date));
    return <><span className={styles.icon}><PageIcon value={entry.icon} size={26} /></span><span className={styles.text}><span className={styles.title}>{entry.title}</span><span className={styles.metadata}><span className={styles.folder} title={entry.folder}>{entry.folder}</span>{entry.creator && <><span aria-hidden="true">·</span><span className={styles.creator}>{entry.creator}</span></>}</span></span><time className={styles.date} dateTime={validDate ? entry.date! : undefined}>{validDate ? formatDate(entry.date!, { year: 'numeric', month: 'short', day: 'numeric' }, locale) : '—'}</time></>;
  }
  return <section className={styles.page} aria-label={title} data-collection={kind} data-page-scroll={scrollKey}><div className={styles.inner}>
    <header className={styles.header}><div className={styles.heading}><h1>{title}</h1>{!loading && !error && <span className={styles.count}>{entries.length}</span>}</div>{onCreate && <Button size="sm" variant="outline" onClick={onCreate}><Plus size="16px" />{t('newDocument')}</Button>}</header>
    <div className={styles.toolbar}><label className={styles.search}><MagnifyingGlass size={16} /><input type="search" aria-label={t('search')} placeholder={t('search')} value={search} onChange={event => setSearch(event.target.value)} disabled={loading} />{search && <button type="button" className="fob-action" aria-label={t('clearSearch')} onClick={() => setSearch('')}><X size={14} /></button>}</label><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={`fob-action ${styles.sort}`} aria-label={t('sort')}><ArrowsDownUp size={16} /><span>{sortLabel(sort)}</span><CaretDown size={12} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuRadioGroup value={sort} onValueChange={value => setSort(value as CollectionSort)}>{(['newest', 'oldest', 'title'] as const).map(value => <DropdownMenuRadioItem key={value} value={value}>{sortLabel(value)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu></div>
    {notice}
    {kind === 'trash' && entries.length > 0 && <p className={styles.notice}><ArrowCounterClockwise size={16} />{t('trashNotice')}</p>}
    {error ? <div className={styles.feedback}>{error}</div> : loading ? <div role="status" aria-label={t('loading')}>{[0, 1, 2].map(value => <div key={value} className={styles.skeleton} aria-hidden="true"><span /><div><i /><i /></div></div>)}</div> : rows.length ? <>
      {search.trim() && <p className={styles.results} role="status">{t('results', { count: rows.length })}</p>}
      <div className={styles.columns} data-trash={kind === 'trash' || undefined} aria-hidden="true"><span>{t('document')}</span><span>{t(dateKind)}</span></div>
      <ul className={styles.list}>{rows.map(entry => <li key={entry.id} className={styles.row} data-document-id={entry.id}>
        {kind === 'trash' ? <div className={styles.main}>{content(entry)}</div> : <button type="button" className={styles.main} aria-label={entry.title} onClick={() => onOpen(entry.id)}>{content(entry)}</button>}
        <div className={styles.actions} data-trash={kind === 'trash' || undefined}>{onRemove && <button type="button" className={`fob-action ${styles.quick}`} data-starred={kind === 'starred' || undefined} aria-label={t(kind === 'starred' ? 'unstar' : 'removeDraft', { title: entry.title })} title={t(kind === 'starred' ? 'unstar' : 'removeDraft', { title: entry.title })} onClick={() => onRemove(entry.id)}>{kind === 'starred' ? <Star size={16} /> : <FileDashed size={16} />}</button>}{renderActions?.(entry.id)}</div>
      </li>)}</ul>
    </> : <EmptyState label={search.trim() ? t('noResults') : emptyLabel} description={search.trim() ? t('noResultsHint') : emptyHint} actions={search.trim() ? <Button size="sm" variant="outline" onClick={() => setSearch('')}>{t('clearSearch')}</Button> : onCreate ? <Button size="sm" variant="outline" onClick={onCreate}><Plus size={14} />{t('newDocument')}</Button> : undefined} />}
    {footer && <p className={styles.footer}><Desktop size={14} />{footer}</p>}
  </div></section>;
}
