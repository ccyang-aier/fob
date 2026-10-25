'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { KnowledgeTemplateSummary } from '@fob/shared/knowledge/templates';
import { FileText, Folder, PencilSimple as Pencil, Trash as Trash2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { requestOpenPageBlock } from '../editor/open-target';
import { useLocalLibrary } from '../local/use-local-library';
import { knowledgeCatalogClient } from '../data/knowledge-catalog-client';
import { TemplateDialog } from './template-dialog';
import { TemplatePreview } from './template-preview';
import { TemplateFields } from './save-template-dialog';
import { useTemplateLibrary } from './use-template-library';
import { messages } from './messages';
import styles from './templates.module.css';
import { usePageVisible } from '@/lib/page-visibility';
import { useTemplateActivity } from './use-template-activity';

export function TemplateDetailsDialog({ template, onClose }: { template: KnowledgeTemplateSummary; onClose: () => void }) {
  const { t } = useTranslation(messages);
  const visible = usePageVisible();
  const beginActivity = useTemplateActivity();
  const library = useTemplateLibrary();
  const { library: local } = useLocalLibrary();
  const [mode, setMode] = useState<'preview' | 'edit' | 'delete'>('preview');
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [title, setTitle] = useState(template.title || template.name);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const { notify } = useAppAlert();
  const base = library.base!;
  const detail = useQuery({ queryKey: ['knowledge', base.id, 'template-detail', template.id], queryFn: () => library.detail(template.id), enabled: visible });
  const folders = useQuery({ queryKey: ['knowledge', base.id, 'template-folders'], enabled: base.source === 'server', queryFn: async ({ signal }) => {
    const items: { id: string; name: string }[] = [];
    let cursor: string | null = null;
    do { const page = await knowledgeCatalogClient.listTeamspaces(base.id, { cursor, limit: 100, signal }); items.push(...page.items); cursor = page.nextCursor; } while (cursor);
    return items;
  } });
  const choices = base.source === 'local' ? local.folders.filter(item => item.knowledgeBaseId === base.id) : folders.data ?? [];
  const destination = folder || (base.source === 'server' ? choices[0]?.id ?? '' : '');
  async function run(action: () => Promise<void>, success: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const current = beginActivity();
    try { await action(); if (current()) notify('success', success); }
    catch (error) { if (current()) setError(error instanceof Error ? error.message : t('failed')); }
    finally { lock.current = false; setBusy(false); }
  }
  async function apply() {
    const current = beginActivity();
    const id = await library.apply(template, title.trim(), destination);
    const navigate = current();
    // A completed background create closes its own dialog without taking over browsing.
    const target = { source: base.source, knowledgeBaseId: base.id, pageId: id };
    onClose();
    if (navigate) requestOpenPageBlock(target);
  }
  const available = detail.isSuccess && (base.source === 'local' || folders.isSuccess) && (base.source === 'local' || Boolean(destination));
  return <TemplateDialog wide={mode === 'preview'} title={t(mode === 'edit' ? 'edit' : mode === 'delete' ? 'delete' : 'preview')} busy={busy} onClose={onClose} footer={<>
    {mode === 'preview' && detail.data?.template.canManage && <div className={styles.manage}><Button variant="ghost" size="sm" onClick={() => setMode('edit')} disabled={busy}><Pencil size={14} />{t('edit')}</Button><Button variant="ghost" size="sm" className={styles.danger} onClick={() => setMode('delete')} disabled={busy}><Trash2 size={14} />{t('delete')}</Button></div>}
    <Button variant="outline" disabled={busy} onClick={mode === 'preview' ? onClose : () => { setMode('preview'); setError(''); }}>{t('cancel')}</Button>
    {mode === 'preview' ? <Button loading={busy} disabled={!available || !title.trim()} onClick={() => void run(apply, t('created'))}><FileText size={14} />{t('createDocument')}</Button> : mode === 'edit' ? <Button loading={busy} disabled={!name.trim()} onClick={() => void run(async () => { await library.update(template.id, { name: name.trim(), description: description.trim() }); onClose(); }, t('updated'))}>{t('save')}</Button> : <Button loading={busy} className={styles.deleteButton} onClick={() => void run(async () => { await library.remove(template.id); onClose(); }, t('removed'))}>{t('delete')}</Button>}
  </>}>
    {mode === 'edit' ? <div className={styles.form}><TemplateFields name={name} description={description} onName={setName} onDescription={setDescription} /></div> : mode === 'delete' ? <p className={styles.deleteText}>{t('confirmDelete', { name: template.name })}</p> : <div className={styles.detailLayout}>
      <div className={styles.previewHost}>{detail.isPending ? <p className={styles.state}>{t('loading')}</p> : detail.isError ? <AppAlert tone="error" title={detail.error.message} action={<Button variant="ghost" onClick={() => void detail.refetch()}>{t('retry')}</Button>} /> : <TemplatePreview detail={detail.data} />}</div>
      <aside className={styles.detailAside}><span className={styles.detailIcon}><FileText size={22} weight="fill" /></span><h3>{template.name}</h3>{template.description && <p>{template.description}</p>}<label className={styles.field}><span>{t('newTitle')}</span><input value={title} maxLength={500} onChange={event => setTitle(event.target.value)} disabled={busy} /></label><label className={styles.field}><span><Folder size={13} />{t('folder')}</span><select aria-label={t('folder')} value={destination} onChange={event => setFolder(event.target.value)} disabled={busy || folders.isFetching}>{base.source === 'local' && <option value="">{t('unfiled')}</option>}{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>{base.source === 'server' && folders.isSuccess && !choices.length && <p className={styles.hint}>{t('noFolders')}</p>}{folders.isError && <AppAlert tone="error" title={t('failed')} action={<Button variant="ghost" onClick={() => void folders.refetch()}>{t('retry')}</Button>} />}</aside>
    </div>}
    {error && <AppAlert tone="error" title={error} />}
  </TemplateDialog>;
}
