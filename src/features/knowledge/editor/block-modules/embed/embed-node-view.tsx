'use client';

import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { Globe, ArrowSquareOut, PencilSimple } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { resolveEmbedTarget, richContentUrl } from '@fob/shared/knowledge/rich-content';
import { RichBlockFrame } from '../rich-content/rich-block-frame';
import { richMessages } from '../rich-content/messages';
import styles from '../rich-content/rich-content.module.css';

export function EmbedNodeView(props: NodeViewProps) {
  const { t } = useTranslation(richMessages);
  const source = richContentUrl(props.node.attrs.url), target = resolveEmbedTarget(source);
  const [editing, setEditing] = useState(!source);
  const [draft, setDraft] = useState(String(props.node.attrs.url || ''));
  const [invalid, setInvalid] = useState(false), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  return <RichBlockFrame props={props} icon={Globe} title={target?.provider === 'bilibili' ? t('bilibili') : t('embedTitle')} actions={<>
    {source && <a className={`fob-action ${styles.iconButton}`} data-surface="plain" href={source} target="_blank" rel="noopener noreferrer" aria-label={t('open')} title={t('open')}><ArrowSquareOut size={16} aria-hidden /></a>}
    {source && props.editor.isEditable && <button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" aria-label={t('edit')} title={t('edit')} onClick={() => { setDraft(source); setEditing(value => !value); }}><PencilSimple size={16} aria-hidden /></button>}
  </>}>
    {editing && props.editor.isEditable ? <form className={styles.form} data-document-export-omit onSubmit={event => {
      event.preventDefault(); const safe = richContentUrl(draft);
      if (!safe) { setInvalid(true); return; }
      props.updateAttributes({ url: safe }); setInvalid(false); setFailed(false); setEditing(false);
    }}>
      <input aria-label={t('url')} type="url" placeholder="https://…" value={draft} onChange={event => setDraft(event.target.value)} required />
      <span className={styles.site}>{t('embedHint')}</span>
      {invalid && <span className={styles.error} role="alert">{t('invalidUrl')}</span>}
      <div className={styles.formActions}>{source && <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('cancel')}</Button>}<Button type="submit" size="sm">{t('embed')}</Button></div>
    </form> : target ? <div className={styles.embedBody}>
      {failed && <div className={styles.error} role="alert">{t('embedFailed')} <button type="button" className={`fob-action ${styles.action}`} data-surface="plain" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>{t('retry')}</button></div>}
      <iframe key={`${target.url}:${attempt}`} className={styles.iframe} title={String(props.node.attrs.title || (target.provider === 'bilibili' ? t('bilibili') : t('embedTitle')))} src={target.url} loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
        sandbox={`allow-scripts allow-forms allow-popups allow-presentation${target.provider === 'web' ? '' : ' allow-same-origin'}`} allow="fullscreen; picture-in-picture; encrypted-media" onError={() => setFailed(true)} />
      <div className={styles.footer} data-document-export-omit><span>{new URL(target.url).hostname}</span><span>{t('embedUnavailable')}</span></div>
    </div> : <div className={styles.state}>{t('invalidUrl')}</div>}
  </RichBlockFrame>;
}
