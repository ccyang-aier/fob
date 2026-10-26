'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './file-node-view.messages';
import { FileText } from '@/components/icons';
import { isPdfSource } from '@fob/shared/knowledge/rich-content';
import { InlinePdfView } from '../rich-content/inline-pdf-view';
import type { NodeViewProps } from '@tiptap/react';
import { MediaBlockView } from '../media-core/media-block-view';
import type { ResolvedMedia } from '../media-core/media-block-view';
import styles from './file.module.css';

function formatSize(size: number | null): string {
  return size === null
    ? ''
    : size < 1024
      ? `${size} B`
      : size < 1024 ** 2
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / 1024 ** 2).toFixed(1)} MB`;
}

export function FileNodeView(
  props: NodeViewProps & { localKnowledgeBaseId?: string; knowledgeBaseId?: string },
) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const title = String(props.node.attrs.title || knowledgeT('attachment'));
  return (
    <MediaBlockView
      {...props}
      kind="file"
      renderPreview={(source) => isPdfSource(String(props.node.attrs.src || ''), props.node.attrs.mime || source.mime, title) ? <InlinePdfView url={source.url} title={source.name || title} /> : <FilePreview source={{ ...source, size: source.size ?? props.node.attrs.size }} title={title} />}
    />
  );
}

function FilePreview({ source, title }: { source: ResolvedMedia; title: string }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);
  const name = source.name || title;
  const extension = name.match(/\.([a-z0-9]{1,8})$/i)?.[1].toUpperCase();
  return (
    <a className={styles.card} href={source.url} download={name} target="_blank" rel="noopener noreferrer" aria-label={`${knowledgeT('download')} ${name}`}>
      <span className={styles.badge} data-type={extension?.toLowerCase()} aria-hidden>
        {extension ? extension.slice(0, 4) : <FileText size={23} />}
      </span>
      <span className={styles.details}>
        <strong className={styles.name} title={name}>{name}</strong>
        <small className={styles.size}>
          {formatSize(source.size ?? null) || source.mime || knowledgeT('attachment')}
        </small>
      </span>
    </a>
  );
}
