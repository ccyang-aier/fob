'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import type { NodeViewProps } from '@tiptap/react';
import { LinkSimple, PencilSimple, ArrowSquareOut } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { linkPreviewSchema } from '@fob/shared/knowledge/contracts';
import { isPdfSource, richContentUrl } from '@fob/shared/knowledge/rich-content';
import type { EditorBlockContext } from '../types';
import { RichBlockFrame } from './rich-block-frame';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

export function LinkCardNodeView(props: NodeViewProps & { context: EditorBlockContext }) {
  const { t } = useTranslation(richMessages);
  const url = richContentUrl(props.node.attrs.url), fetched = props.node.attrs.fetched === true;
  const [editing, setEditing] = useState(!url);
  const [draft, setDraft] = useState(String(props.node.attrs.url || ''));
  const [description, setDescription] = useState(String(props.node.attrs.description || ''));
  const [invalid, setInvalid] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [request, setRequest] = useState<{ url: string; error: boolean } | null>(null);
  const { editor, updateAttributes } = props;
  const knowledgeBaseId = props.context.localKnowledgeBaseId ?? props.context.scope?.knowledgeBaseId ?? props.context.knowledgeBaseId;
  const source = props.context.localKnowledgeBaseId ? 'local' : 'server';
  useEffect(() => {
    if (!url || fetched || editing || !editor.isEditable) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    void (async () => {
      if (!knowledgeBaseId) throw new Error('MISSING_LIBRARY');
      const { origin } = await getFobApiOrigin();
      const response = await fetch(`${origin}/api/knowledge/${knowledgeBaseId}/rich-content/link-preview`, { method: 'POST', credentials: source === 'server' ? 'include' : 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, url }), signal: controller.signal });
      if (!response.ok) throw new Error('PREVIEW_UNAVAILABLE');
      const metadata = linkPreviewSchema.parse(await response.json());
      if (!controller.signal.aborted && !editor.isDestroyed && editor.isEditable) updateAttributes({ title: metadata.title, description: metadata.description, image: metadata.image, siteName: metadata.siteName, fetched: true });
    })().catch(() => { if (active) setRequest({ url, error: true }); }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [url, fetched, editing, editor, updateAttributes, knowledgeBaseId, source, attempt]);

  const convert = (kind: 'link' | 'embed') => {
    if (!url || !editor.isEditable) return;
    const pos = props.getPos();
    if (typeof pos !== 'number') return;
    const current = editor.state.doc.nodeAt(pos);
    if (current?.type.name !== 'linkCard') return;
    const id = current.attrs.blockId;
    const node = kind === 'link'
      ? editor.schema.nodes.paragraph.create({ blockId: id }, editor.schema.text(String(current.attrs.title || url), [editor.schema.marks.link.create({ href: url })]))
      : isPdfSource(url) ? editor.schema.nodes.pdf.create({ blockId: id, src: url, title: current.attrs.title || 'PDF' })
      : editor.schema.nodes.embed.create({ blockId: id, url, title: current.attrs.title || new URL(url).hostname });
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + current.nodeSize, node).scrollIntoView());
  };
  const failed = request?.url === url && request.error;
  return <RichBlockFrame props={props} icon={LinkSimple} title={t('linkCard')} resizable={false} actions={<>
    {url && <a href={url} target="_blank" rel="noopener noreferrer" title={t('open')} aria-label={t('open')} className={`fob-action ${styles.iconButton}`} data-surface="plain"><ArrowSquareOut size={16} aria-hidden /></a>}
    {editor.isEditable && url && <button type="button" title={t('edit')} aria-label={t('edit')} className={`fob-action ${styles.iconButton}`} data-surface="plain" onClick={() => { setDraft(url); setDescription(String(props.node.attrs.description || '')); setEditing(value => !value); }}><PencilSimple size={16} aria-hidden /></button>}
  </>}>
    {editing && editor.isEditable ? <form className={styles.form} data-document-export-omit onSubmit={event => {
      event.preventDefault(); const safe = richContentUrl(draft);
      if (!safe) { setInvalid(true); return; }
      const manual = Boolean(props.node.attrs.title || description.trim());
      updateAttributes({ url: safe, description, ...(safe !== url ? { fetched: manual, image: '', siteName: '' } : { fetched: fetched || manual }) });
      setRequest(null); setInvalid(false); setEditing(false);
    }}>
      <input type="url" aria-label={t('url')} placeholder="https://…" value={draft} onChange={event => setDraft(event.target.value)} required />
      <textarea aria-label={t('description')} placeholder={t('description')} value={description} maxLength={2000} rows={3} onChange={event => setDescription(event.target.value)} />
      {invalid && <span className={styles.error} role="alert">{t('invalidUrl')}</span>}
      <div className={styles.formActions}>{url && <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>{t('cancel')}</Button>}<Button type="submit" size="sm">{t('save')}</Button></div>
    </form> : url ? <>
      <a className={styles.card} href={url} target="_blank" rel="noopener noreferrer">
        <span className={styles.cardText}><strong className={styles.cardTitle}>{String(props.node.attrs.title || new URL(url).hostname)}</strong>
          {props.node.attrs.description && <span className={styles.description}>{String(props.node.attrs.description)}</span>}
          <span className={styles.site}>{String(props.node.attrs.siteName || new URL(url).hostname)} · {url}</span>
        </span>
        {richContentUrl(props.node.attrs.image) && <Image key={String(props.node.attrs.image)} className={styles.cover} src={String(props.node.attrs.image)} width={160} height={112} unoptimized alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}
      </a>
      {editor.isEditable && <div className={styles.footer} data-document-export-omit>
        <span role="status">{!fetched ? failed ? t('metadataError') : t('metadataLoading') : t('displayAs')}</span>
        <div className={styles.actions}>{failed && <button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={() => { setRequest(null); setAttempt(value => value + 1); }}>{t('retry')}</button>}
          <button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={() => convert('link')}>{t('link')}</button>
          <button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={() => convert('embed')}>{t('embed')}</button>
        </div>
      </div>}
    </> : <div className={styles.state}>{t('invalidUrl')}</div>}
  </RichBlockFrame>;
}
