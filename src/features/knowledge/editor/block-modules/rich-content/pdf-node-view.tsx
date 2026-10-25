'use client';

import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { richContentUrl } from '@fob/shared/knowledge/rich-content';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { MediaBlockView } from '../media-core/media-block-view';
import type { EditorBlockContext } from '../types';
import { InlinePdfView } from './inline-pdf-view';
import { BlockResize } from './block-resize';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

export function PdfNodeView(props: NodeViewProps & { context: EditorBlockContext }) {
  const { t } = useTranslation(richMessages);
  const [url, setUrl] = useState(''), [invalid, setInvalid] = useState(false);
  const source = String(props.node.attrs.src || '');
  return <>
    <MediaBlockView {...props} kind="pdf" localKnowledgeBaseId={props.context.localKnowledgeBaseId} knowledgeBaseId={props.context.scope?.knowledgeBaseId ?? props.context.knowledgeBaseId} renderPreview={resolved => <InlinePdfView key={source} url={resolved.url} title={String(props.node.attrs.title || resolved.name || 'PDF')} height={Number(props.node.attrs.height || 520)} />}>
      {source && props.editor.isEditable && <BlockResize height={Number(props.node.attrs.height || 520)} onChange={height => props.updateAttributes({ height })} />}
      {!source && props.editor.isEditable && <form className={styles.form} data-document-export-omit onSubmit={event => { event.preventDefault(); const safe = richContentUrl(url); if (!safe) { setInvalid(true); return; } props.updateAttributes({ src: safe, title: new URL(safe).pathname.split('/').at(-1) || 'PDF', mime: 'application/pdf' }); }}>
        <input type="url" aria-label={t('pdfUrl')} placeholder="https://…/document.pdf" value={url} onChange={event => setUrl(event.target.value)} required />
        {invalid && <span role="alert" className={styles.error}>{t('invalidUrl')}</span>}
        <div className={styles.formActions}><Button type="submit" variant="outline" size="sm">{t('useUrl')}</Button></div>
      </form>}
    </MediaBlockView>
  </>;
}
