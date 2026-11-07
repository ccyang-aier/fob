'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './image-node-view.messages';
import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { ArrowsLeftRight, MagnifyingGlassPlus } from '@/components/icons';
import { usePageVisible } from '@/lib/page-visibility';
import { BlockActions } from '../block-actions';
import { MediaBlockView, type MediaBlockActionsProps } from '../media-core/media-block-view';
import { GraphicPreviewDialog } from '../rich-content/graphic-preview';
import { GraphicToolButton } from '../rich-content/frame/tool-button';

export function ImageNodeView(
  props: NodeViewProps & { localKnowledgeBaseId?: string; knowledgeBaseId?: string },
) {
  return (
    <MediaBlockView
      {...props}
      kind="image"
      actions={ImageActions}
      renderPreview={(source) => (
        <ImagePreview
          key={source.url}
          src={source.url}
          alt={String(props.node.attrs.alt || source.name || '')}
        />
      )}
    />
  );
}

function ImageActions({ source, title, onReplace }: MediaBlockActionsProps) {
  const { t } = useTranslation(knowledgeMessages);
  const visible = usePageVisible();
  const [enlarged, setEnlarged] = useState(false);
  return <>
    <BlockActions placement="canvas" touchVisibility="on-demand">
      <GraphicToolButton label={t('enlarge')} onClick={() => setEnlarged(true)}>
        <MagnifyingGlassPlus size={16} aria-hidden />
      </GraphicToolButton>
      {onReplace && <GraphicToolButton label={t('replace')} onClick={onReplace}>
        <ArrowsLeftRight size={16} aria-hidden />
      </GraphicToolButton>}
    </BlockActions>
    {visible && enlarged && <GraphicPreviewDialog presentation="image" src={source.url} title={title || t('image')} onClose={() => setEnlarged(false)} />}
  </>;
}

function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [failed, setFailed] = useState(false);
  // Object URLs and user supplied hosts cannot use the Next image proxy.
  return failed ? (
    <span className="p-8 text-xs text-[var(--err-ink)]">
      {knowledgeT('unableToLoadImageCheckTheUrlOr')}
    </span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- Object URLs bypass the image proxy.
    <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
  );
}
