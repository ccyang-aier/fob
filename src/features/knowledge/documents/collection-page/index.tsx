'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import type { DocumentPreview } from '@fob/shared/knowledge/document-insights';
import { ArrowsDownUp, ArrowCounterClockwise, CaretDown, Desktop, FileDashed, FileText, Folder, MagnifyingGlass, Plus, Star, Trash, X } from '@/components/icons';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { ViewSwitcher, type ViewMode } from '@/components/ui/view-switcher';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatDate, useTranslation } from '@/lib/i18n';
import { usePageScrollKey, usePageSessionState } from '@/lib/page-session-state';
import { PageIcon } from '../../navigation/page-icon';
import { collectionFolderPath, collectionRows, type CollectionEntry, type CollectionFolder, type CollectionKind, type CollectionSort } from './model';
import { messages } from './messages';
import resourceStyles from '@/components/ui/resource-card.module.css';
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
  previews?: Readonly<Record<string, DocumentPreview | null>>;
  previewLoading?: boolean;
  onVisibleIdsChange?(ids: string[]): void;
};

export function DocumentCollectionPage({ title, kind, entries, folders, onOpen, onCreate, onRemove, renderActions, dateKind = 'updated', loading = false, error, notice, footer, previews, previewLoading = false, onVisibleIdsChange }: CollectionPageProps) {
  const { t, locale } = useTranslation(messages);
  const [search, setSearch] = usePageSessionState(`collection.${kind}.search`, '');
  const [sort, setSort] = usePageSessionState<CollectionSort>(`collection.${kind}.sort`, 'newest');
  const [layout, setLayout] = usePageSessionState<ViewMode>(`collection.${kind}.layout`, 'grid');
  const [location, setLocation] = usePageSessionState(`collection.${kind}.location`, 'all');
  const [limit, setLimit] = useState(24);
  const scrollKey = usePageScrollKey(`collection:${kind}`);
  const places = folders.filter(folder => entries.some(entry => entry.folderId === folder.id)).map(folder => ({ ...folder, path: collectionFolderPath(folder.id, folders, t('unfiled')) }));
  const activeLocation = places.some(folder => folder.id === location) || location === 'unfiled' ? location : 'all';
  const rows = useMemo(() => collectionRows(entries, folders, search, sort, locale, t('unfiled')).filter(entry => activeLocation === 'all' || (activeLocation === 'unfiled' ? !entry.folderId : entry.folderId === activeLocation)), [entries, folders, search, sort, locale, t, activeLocation]);
  const shown = rows.slice(0, limit);
  const visibleKey = JSON.stringify(layout === 'grid' && kind !== 'trash' && !loading && !error ? shown.map(entry => entry.id) : []);
  useEffect(() => { onVisibleIdsChange?.(JSON.parse(visibleKey) as string[]); }, [visibleKey, onVisibleIdsChange]);
  const HeaderIcon = kind === 'starred' ? Star : kind === 'drafts' ? FileDashed : kind === 'trash' ? Trash : FileText;
  const emptyLabel = kind === 'starred' ? t('emptyStarred') : kind === 'drafts' ? t('emptyDrafts') : kind === 'trash' ? t('emptyTrash') : t('emptyDocuments');
  const emptyHint = kind === 'starred' ? t('starredHint') : kind === 'drafts' ? t('draftsHint') : kind === 'trash' ? t('trashHint') : undefined;
  const filtered = Boolean(search.trim() || activeLocation !== 'all');
  const sortLabel = (value: CollectionSort) => t(dateKind === 'deleted' && value !== 'title' ? value === 'newest' ? 'newestDeleted' : 'oldestDeleted' : value);
  const date = (entry: CollectionEntry) => entry.date && Number.isFinite(Date.parse(entry.date)) ? <time dateTime={entry.date}>{formatDate(entry.date, { year: 'numeric', month: 'short', day: 'numeric' }, locale)}</time> : <span>—</span>;
  const actions = (entry: CollectionEntry) => <>
    {onRemove && <button type="button" className={`fob-action ${styles.quick}`} data-starred={kind === 'starred' || undefined} aria-label={t(kind === 'starred' ? 'unstar' : 'removeDraft', { title: entry.title })} title={t(kind === 'starred' ? 'unstar' : 'removeDraft', { title: entry.title })} onClick={() => onRemove(entry.id)}>{kind === 'starred' ? <Star size={16} /> : <FileDashed size={16} />}</button>}
    {renderActions?.(entry.id)}
  </>;
  function reset() { setSearch(''); setLocation('all'); }

  return <section className={styles.page} aria-label={title} aria-busy={loading} data-collection={kind} data-page-scroll={scrollKey}>
    <div className={styles.inner}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.headingIcon} data-kind={kind} aria-hidden="true"><HeaderIcon size={24} /></span>
          <h1>{title}</h1>
          {!loading && !error && <span className={styles.count}>{entries.length}</span>}
        </div>
        {onCreate && <Button size="sm" className={styles.create} onClick={onCreate}><Plus size={16} />{t('newDocument')}</Button>}
      </header>

      <div className={styles.toolbar}>
        <div className={styles.scope}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className={`fob-action ${styles.location}`} aria-label={t('location')}><Folder size={14} /><span>{activeLocation === 'all' ? t('allLocations') : activeLocation === 'unfiled' ? t('unfiled') : places.find(folder => folder.id === activeLocation)?.path}</span><CaretDown size={12} /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={activeLocation} onValueChange={value => { setLocation(value); setLimit(24); }}>
              <DropdownMenuRadioItem value="all">{t('allLocations')}</DropdownMenuRadioItem>
              {places.map(folder => <DropdownMenuRadioItem key={folder.id} value={folder.id}><span className={styles.locationOption}>{folder.path}</span></DropdownMenuRadioItem>)}
              {entries.some(entry => !entry.folderId) && <DropdownMenuRadioItem value="unfiled">{t('unfiled')}</DropdownMenuRadioItem>}
            </DropdownMenuRadioGroup></DropdownMenuContent>
          </DropdownMenu>
          {filtered && !error && !loading && <span className={styles.results} role="status">{t('results', { count: rows.length })}</span>}
        </div>
        <div className={styles.tools}>
          <label className={styles.search}><MagnifyingGlass size={16} /><input type="search" aria-label={t('search')} placeholder={t('searchPlaceholder')} value={search} onChange={event => { setSearch(event.target.value); setLimit(24); }} disabled={loading} />{search && <button type="button" className="fob-action" aria-label={t('clearSearch')} onClick={() => setSearch('')}><X size={14} /></button>}</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className={`fob-action ${styles.sort}`} aria-label={t('sort')} title={sortLabel(sort)}><ArrowsDownUp size={16} /><span>{sortLabel(sort)}</span><CaretDown size={12} /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={sort} onValueChange={value => setSort(value as CollectionSort)}>{(['newest', 'oldest', 'title'] as const).map(value => <DropdownMenuRadioItem key={value} value={value}>{sortLabel(value)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
          </DropdownMenu>
          <ViewSwitcher value={layout} onValueChange={setLayout} />
        </div>
      </div>
      {notice}
      {kind === 'trash' && entries.length > 0 && <p className={styles.notice}><ArrowCounterClockwise size={14} />{t('trashNotice')}</p>}

      {error ? <div className={styles.feedback}>{error}</div> : loading ? <div className={styles.grid} role="status" aria-label={t('loading')}>{[0, 1, 2].map(value => <div key={value} className={`${resourceStyles.card} ${styles.skeleton}`} aria-hidden="true"><span /><i /><i /></div>)}</div> : rows.length ? <>
        {layout === 'list' && <div className={styles.listHeader} aria-hidden="true"><span>{t('document')}</span><span>{t('location')}</span><span>{t(dateKind)}</span><span /></div>}
        <ul className={layout === 'grid' ? styles.grid : styles.list}>
          {shown.map(entry => {
            const contents = <>
              <Preview value={previews?.[entry.id]} pending={previewLoading} icon={entry.icon} trash={kind === 'trash'} />
              <div className={styles.cardInfo}><span className={styles.cardTitle}>{entry.title}</span><span className={styles.cardLocation} title={entry.folder}><Folder size={12} />{entry.folder}</span></div>
            </>;
            return layout === 'grid' ? <li key={entry.id} className={`${resourceStyles.card} ${styles.card}`} data-document-id={entry.id} data-trash={kind === 'trash' || undefined}>
              {kind === 'trash' ? <div className={styles.cardMain}>{contents}</div> : <button type="button" className={styles.cardMain} aria-label={entry.title} onClick={() => onOpen(entry.id)}>{contents}</button>}
              <div className={styles.cardFooter}>
                <span className={styles.author}>{entry.creator && <><span className={styles.avatar} aria-hidden="true">{entry.creator.slice(0, 1)}</span><span>{entry.creator}</span></>}</span>
                <span className={styles.cardDate}><span>{t(dateKind)}</span>{date(entry)}</span>
              </div>
              <div className={styles.cardActions}>{actions(entry)}</div>
            </li> : <li key={entry.id} className={styles.row} data-document-id={entry.id}>
              {kind === 'trash' ? <div className={styles.listMain}><PageIcon value={entry.icon} size={24} /><span><strong>{entry.title}</strong>{entry.creator && <small>{entry.creator}</small>}</span></div> : <button type="button" className={styles.listMain} aria-label={entry.title} onClick={() => onOpen(entry.id)}><PageIcon value={entry.icon} size={24} /><span><strong>{entry.title}</strong>{entry.creator && <small>{entry.creator}</small>}</span></button>}
              <span className={styles.listLocation} title={entry.folder}>{entry.folder}</span><span className={styles.listDate}>{date(entry)}</span><div className={styles.listActions}>{actions(entry)}</div>
            </li>;
          })}
        </ul>
        {rows.length > shown.length && <div className={styles.more}><Button variant="outline" size="sm" onClick={() => setLimit(current => current + 24)}>{t('showMore')}</Button></div>}
      </> : <EmptyState label={filtered ? t('noResults') : emptyLabel} description={filtered ? t('noResultsHint') : emptyHint} actions={filtered ? <Button size="sm" variant="outline" onClick={reset}>{t('clearSearch')}</Button> : onCreate ? <Button size="sm" variant="outline" onClick={onCreate}><Plus size={14} />{t('newDocument')}</Button> : undefined} />}
      {footer && <p className={styles.footer}><Desktop size={14} />{footer}</p>}
    </div>
  </section>;
}

function Preview({ value, pending, icon, trash }: { value?: DocumentPreview | null; pending: boolean; icon?: string | null; trash: boolean }) {
  const { t } = useTranslation(messages);
  if (trash) return <div className={styles.trashCover}><PageIcon value={icon} size={36} /><span>{t('deletedDocument')}</span></div>;
  return <div className={styles.preview} aria-hidden="true">
    {value?.image ? <Image src={value.image} alt="" fill unoptimized sizes="(max-width: 540px) 100vw, 33vw" className={styles.previewImage} /> : value ? <div className={styles.paper}>
      <span className={styles.paperIcon}><PageIcon value={icon} size={22} /></span>
      {value.heading && <strong>{value.heading}</strong>}
      {value.lines.slice(0, 3).map((line, index) => <p key={index}>{line}</p>)}
      {value.graphic && <span className={styles.graphicLabel}>{t('containsGraphic')}</span>}
      {!value.heading && !value.lines.length && !value.graphic && <span className={styles.previewState}>{t(value.empty ? 'emptyBody' : 'noText')}</span>}
    </div> : pending ? <div className={styles.previewSkeleton}><span /><i /><i /><i /></div> : <div className={styles.previewMissing}><PageIcon value={icon} size={36} /><span>{t('previewUnavailable')}</span></div>}
  </div>;
}
