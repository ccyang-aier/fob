'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, MagnifyingGlass as Search, CaretRight as ChevronRight } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useTranslation } from '@/lib/i18n';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import { fetchKnowledgePages } from '../data/pages-api';
import { useLocalLibrary } from '../local/use-local-library';
import { TemplateDialog } from './template-dialog';
import { messages } from './messages';
import styles from './templates.module.css';

export function TemplateSourceDialog({ onClose, onSelect }: { onClose: () => void; onSelect: (source: { id: string; title: string }) => void }) {
  const { t } = useTranslation(messages);
  const { selectedKnowledgeBase: base } = useKnowledgeBaseResources();
  const { library } = useLocalLibrary();
  const [search, setSearch] = useState('');
  const pages = useQuery({ queryKey: ['knowledge', base?.id, 'template-sources'], enabled: base?.source === 'server', queryFn: ({ signal }) => fetchKnowledgePages(base!.id, {}, signal) });
  const items = base?.source === 'local' ? library.documents.filter(item => item.baseId === base.id && !item.deleted && !item.file) : (pages.data ?? []).filter(item => item.kind === 'doc' && !item.deletedAt);
  const filtered = items.filter(item => item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <TemplateDialog title={t('chooseSource')} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>{t('cancel')}</Button>}><label className={styles.search}><Search size={15} /><input autoFocus placeholder={t('searchDocuments')} aria-label={t('searchDocuments')} value={search} onChange={event => setSearch(event.target.value)} /></label><div className={styles.sourceList}>{base?.source === 'server' && pages.isPending ? <p className={styles.state}>{t('loading')}</p> : pages.isError && base?.source === 'server' ? <AppAlert tone="error" title={t('failed')} action={<Button variant="ghost" onClick={() => void pages.refetch()}>{t('retry')}</Button>} /> : filtered.length ? filtered.map(item => <button type="button" className={`fob-action ${styles.sourceRow}`} key={item.id} onClick={() => onSelect(item)}><FileText size={16} /><span>{item.title}</span><ChevronRight size={14} /></button>) : <p className={styles.state}>{t('noDocuments')}</p>}</div></TemplateDialog>;
}
