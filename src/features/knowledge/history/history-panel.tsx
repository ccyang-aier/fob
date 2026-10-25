'use client';
import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { CaretRight, ClockCounterClockwise, Plus } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { messages } from '../sharing/collaboration.messages';
import { DocumentAvatar, DocumentSwitch } from '../sharing/document-share-dialog';
import { DocumentModal } from '../sharing/document-modal';
import { createHistoryApi, type HistoryApi } from './history-api';
import { renderCheckpointHtml } from './restore';
import styles from './history-panel.module.css';
import collaborationStyles from '../sharing/document-collaboration.module.css';

const defaultApi = createHistoryApi();
export interface HistoryPanelProps { knowledgeBaseId: string; pageId: string; editor: Editor | null; canEdit: boolean; onClose(): void; api?: HistoryApi }
export function HistoryPanel({ knowledgeBaseId, pageId, editor, canEdit, onClose, api = defaultApi }: HistoryPanelProps) {
  const { t, locale } = useTranslation(messages), { notify } = useAppAlert(), client = useQueryClient();
  const [busy, setBusy] = useState(false), [selectionId, setSelectedId] = useState<string | null>(null);
  const [reference, setReference] = useState('previous'), [highlight, setHighlight] = useState(true);
  const [naming, setNaming] = useState(false), [label, setLabel] = useState(''), [confirm, setConfirm] = useState(false);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), [locale]);
  const versions = useInfiniteQuery({ queryKey: [knowledgeBaseId, 'history', pageId], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.list(knowledgeBaseId, pageId, pageParam), getNextPageParam: last => last.nextCursor ?? undefined });
  const entries = versions.data?.pages.flatMap(page => page.checkpoints) ?? [];
  const selectedId = selectionId ?? entries[0]?.checkpointId ?? null;
  const phase = versions.isPending ? 'loading' : versions.isError ? 'error' : 'ready';
  const selected = useQuery({ queryKey: [knowledgeBaseId, 'history', pageId, selectedId, reference], enabled: Boolean(selectedId),
    queryFn: async ({ signal }) => { const [preview, comparison] = await Promise.all([api.preview(knowledgeBaseId, pageId, selectedId!, signal), api.compare(knowledgeBaseId, pageId, selectedId!, reference, signal)]); return { preview, comparison }; } });
  const preview = selected.data?.preview, comparison = selected.data?.comparison;
  const previewPhase = selected.isPending ? 'loading' : selected.isError ? 'error' : 'ready';
  const html = useMemo(() => preview && editor ? renderCheckpointHtml(preview.body, editor.schema) : null, [preview, editor]);
  const added = comparison?.differences.filter(line => line.kind === 'added').length ?? 0;
  const removed = comparison?.differences.filter(line => line.kind === 'removed').length ?? 0;
  const versionLabel = (entry: { label: string | null; createdAt: string }) => entry.label === 'Before restore' ? t('beforeRestore') : entry.label === 'Restored version' ? t('restoredVersion') : entry.label ?? formatter.format(new Date(entry.createdAt));
  async function save() {
    if (!label.trim() || busy) return;
    setBusy(true);
    try { const result = await api.name(knowledgeBaseId, pageId, label.trim()); setNaming(false); setLabel(''); await client.invalidateQueries({ queryKey: [knowledgeBaseId, 'history', pageId] }); setSelectedId(result.checkpointId); notify('success', t('versionSaved')); }
    catch { notify('error', t('failed')); } finally { setBusy(false); }
  }
  async function restore() {
    if (!preview || busy || !canEdit) return;
    setBusy(true);
    try { await api.restore(knowledgeBaseId, pageId, preview.checkpointId); await Promise.all([client.invalidateQueries({ queryKey: [knowledgeBaseId, 'knowledge', 'pages'] }), client.invalidateQueries({ queryKey: [knowledgeBaseId, 'history', pageId] })]); notify('success', t('restored')); setConfirm(false); onClose(); }
    catch { notify('error', t('failed')); } finally { setBusy(false); }
  }
  return <section aria-label={t('history')} className={`${styles.panel} ${collaborationStyles.surface}`}>
    <header className={styles.heading}><h2>{t('history')}</h2><button className={`fob-action ${styles.close}`} aria-label={t('close')} onClick={onClose}><CaretRight size={20} /></button></header>
    <div className={styles.controls}><label><span>{t('highlight')}</span><DocumentSwitch label={t('highlight')} checked={highlight} onChange={() => setHighlight(value => !value)} /></label>
      <label><span>{t('compare')}</span><select aria-label={t('compare')} value={reference} onChange={event => setReference(event.target.value)}><option value="previous">{t('previous')}</option><option value="current">{t('current')}</option>{entries.filter(entry => entry.checkpointId !== selectedId).map(entry => <option key={entry.checkpointId} value={entry.checkpointId}>{versionLabel(entry)}</option>)}</select></label>
    </div>
    {canEdit && <div className={styles.saveRow}>{naming ? <form onSubmit={event => { event.preventDefault(); void save(); }}><input autoFocus aria-label={t('versionName')} placeholder={t('versionName')} value={label} onChange={event => setLabel(event.target.value)} maxLength={200} /><Button variant="outline" size="sm" loading={busy} disabled={!label.trim()} type="submit">{t('save')}</Button><button type="button" className="fob-action" onClick={() => setNaming(false)}>{t('cancel')}</button></form> : <button className="fob-action" onClick={() => setNaming(true)}><Plus size={14} />{t('nameVersion')}</button>}</div>}
    <div className={styles.versions}>
      {phase === 'loading' && <p role="status" className={styles.empty}>{t('loading')}</p>}
      {phase === 'error' && <div className={styles.error}><AppAlert tone="error" title={t('failed')} /><Button variant="outline" size="sm" onClick={() => void versions.refetch()}>{t('retry')}</Button></div>}
      {phase === 'ready' && !entries.length && <div className={styles.empty}><ClockCounterClockwise size={24} /><strong>{t('noVersions')}</strong><p>{t('historyHint')}</p></div>}
      {entries.map(entry => <button key={entry.checkpointId} className={`fob-action ${styles.version}`} aria-current={selectedId === entry.checkpointId ? 'true' : undefined} onClick={() => setSelectedId(entry.checkpointId)}>
        {entry.authorDetails?.[0] ? <DocumentAvatar name={entry.authorDetails[0].name} image={entry.authorDetails[0].image} /> : <span className={styles.versionIcon}><ClockCounterClockwise size={17} /></span>}
        <span><strong>{versionLabel(entry)}</strong><small>{entry.authorDetails?.map(person => person.name).join(locale === 'zh-CN' ? '、' : ', ')}{entry.authorDetails?.length ? ' · ' : ''}{formatter.format(new Date(entry.createdAt))}</small></span>
        <span className={styles.versionMarker} />
      </button>)}
      {versions.hasNextPage && <Button variant="ghost" size="sm" loading={versions.isFetchingNextPage} onClick={() => void versions.fetchNextPage()}>{t('loadMore')}</Button>}
    </div>
    {selectedId && <div className={styles.preview} aria-label={t('preview')}>
      <div className={styles.previewHeading}><strong>{preview?.title || t('unnamed')}</strong>{highlight && comparison && <span><ins>{t('added', { count: added })}</ins><del>{t('removed', { count: removed })}</del></span>}</div>
      <div className={styles.previewBody} aria-busy={previewPhase === 'loading'}>
        {previewPhase === 'loading' ? <p role="status">{t('loading')}</p> : previewPhase === 'error' ? <><AppAlert tone="error" title={t('failed')} /><Button variant="outline" size="sm" onClick={() => void selected.refetch()}>{t('retry')}</Button></> : highlight && comparison ? <>
          {comparison.beforeTitle !== comparison.afterTitle && <p className={styles.titleDifference}><del>{comparison.beforeTitle}</del><ins>{comparison.afterTitle}</ins></p>}
          {!added && !removed && <p className={styles.noChanges}>{t('noChanges')}</p>}
          {comparison.differences.map((line, index) => line.kind === 'added' ? <ins className={styles.added} key={index}>{line.text || t('contentBlock')}</ins> : line.kind === 'removed' ? <del className={styles.removed} key={index}>{line.text || t('contentBlock')}</del> : <p key={index}>{line.text || t('contentBlock')}</p>)}
        </> : <div className="knowledge-preview" dangerouslySetInnerHTML={{ __html: html ?? '' }} />}
      </div>
      {canEdit && <footer><Button variant="outline" size="sm" disabled={previewPhase !== 'ready' || !preview || busy} onClick={() => setConfirm(true)}>{t('restore')}</Button></footer>}
    </div>}
    {confirm && <DocumentModal title={t('restoreConfirm')} onClose={() => { if (!busy) setConfirm(false); }}><p className={styles.confirmText}>{t('restoreHint')}</p><div className={styles.confirmButtons}><Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm(false)}>{t('cancel')}</Button><Button size="sm" loading={busy} onClick={() => void restore()}>{t('restore')}</Button></div></DocumentModal>}
  </section>;
}
