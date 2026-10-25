'use client';

import { useDeferredValue, useState } from 'react';
import { ArrowUpRight, FileText, SquaresFour as LayoutTemplate, Plus, MagnifyingGlass as Search, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useTranslation, formatDate } from '@/lib/i18n';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import { KnowledgeQueryProvider } from '../data/provider';
import { CanvasState } from '../canvas-states';
import { AppAlert } from '@/components/app-alert';
import type { KnowledgeTemplateSummary } from '@fob/shared/knowledge/templates';
import { useTemplateLibrary } from './use-template-library';
import { TemplateDetailsDialog } from './template-details-dialog';
import { TemplateSourceDialog } from './template-source-dialog';
import { SaveTemplateDialog } from './save-template-dialog';
import { messages } from './messages';
import styles from './templates.module.css';

export function TemplatesPage() {
  const { selectedKnowledgeBase: base, scopeKey } = useKnowledgeBaseResources();
  const { t } = useTranslation(messages);
  return base ? <KnowledgeQueryProvider key={scopeKey}><TemplateLibraryContent /></KnowledgeQueryProvider> : <CanvasState title={t('selectBase')} />;
}

function TemplateLibraryContent() {
  const { t, locale } = useTranslation(messages);
  const { principal } = useKnowledgeBaseResources();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const library = useTemplateLibrary(query);
  const [mine, setMine] = useState(false);
  const [selected, setSelected] = useState<KnowledgeTemplateSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState<{ id: string; title: string } | null>(null);
  const items = library.items.filter(item => !mine || item.createdBy === principal || item.createdBy === 'local');
  return <section className={styles.page} aria-label={t('title')}><div className={styles.inner}>
    <header className={styles.header}><div><span className={styles.eyebrow}><LayoutTemplate size={14} />{library.base?.name}</span><h1>{t('title')}</h1><p>{t('subtitle')}</p></div><Button size="sm" onClick={() => setCreating(true)}><Plus size={14} />{t('create')}</Button></header>
    <div className={styles.toolbar}><div className={styles.filters}><button type="button" className="fob-action" aria-pressed={!mine} onClick={() => setMine(false)}>{t('all')}</button><button type="button" className="fob-action" aria-pressed={mine} onClick={() => setMine(true)}>{t('mine')}</button></div><label className={styles.search}><Search size={14} /><input value={search} aria-label={t('search')} placeholder={t('search')} onChange={event => setSearch(event.target.value)} />{search && <button type="button" className="fob-action" aria-label={t('clear')} onClick={() => setSearch('')}><X size={14} /></button>}</label></div>
    {library.error ? <AppAlert tone="error" title={library.error instanceof Error ? library.error.message : t('localSaveFailed')} action={<Button variant="ghost" onClick={() => void library.query.refetch()}>{t('retry')}</Button>} /> : library.loading ? <p className={styles.state}>{t('loading')}</p> : items.length ? <><div className={styles.grid}>{items.map((template, index) => <button key={template.id} type="button" className={`fob-action ${styles.card}`} onClick={() => setSelected(template)}><div className={styles.cardArt} data-tone={index % 4}><div className={styles.paper}><FileText size={16} /><strong>{template.name}</strong><i /><i /><i /></div><span className={styles.cardArrow}><ArrowUpRight size={16} /></span></div><div className={styles.cardInfo}><h2>{template.name}</h2><p>{template.description || template.title}</p><span>{formatDate(template.updatedAt, { month: 'short', day: 'numeric' }, locale)}<span>{library.base?.source === 'local' ? t('local') : t('team')}</span></span></div></button>)}</div><div className={styles.listFooter}><span>{t('count', { count: items.length })}</span>{library.query.hasNextPage && <Button size="sm" variant="outline" loading={library.query.isFetchingNextPage} onClick={() => void library.query.fetchNextPage()}>{t('loadMore')}</Button>}</div></> : <div className={styles.empty}><div className={styles.emptyArt}><span /><FileText size={32} /><span /></div><h2>{t(query || mine ? 'noResults' : 'empty')}</h2>{!query && !mine && <p>{t('emptyHint')}</p>}<Button size="sm" variant="outline" onClick={() => { if (query || mine) { setSearch(''); setMine(false); } else setCreating(true); }}><Plus size={14} />{t(query || mine ? 'clear' : 'create')}</Button></div>}
    {!items.length && library.query.hasNextPage && <Button className="mx-auto mt-4 flex" size="sm" variant="outline" loading={library.query.isFetchingNextPage} onClick={() => void library.query.fetchNextPage()}>{t('loadMore')}</Button>}
  </div>{selected && <TemplateDetailsDialog key={selected.id} template={selected} onClose={() => setSelected(null)} />}{creating && <TemplateSourceDialog onClose={() => setCreating(false)} onSelect={value => { setSource(value); setCreating(false); }} />}{source && <SaveTemplateDialog sourcePageId={source.id} title={source.title} onClose={() => setSource(null)} onSaved={() => void library.refresh()} />}</section>;
}
