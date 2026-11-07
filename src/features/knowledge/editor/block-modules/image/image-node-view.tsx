'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './image-node-view.messages';
import { useState, type CSSProperties } from 'react';
import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { ArrowsLeftRight, MagnifyingGlassPlus } from '@/components/icons';
import { usePageVisible } from '@/lib/page-visibility';
import { BlockActions } from '../block-actions';
import { BlockAlignmentMenu } from '../block-alignment-menu';
import { MediaBlockView, type MediaBlockActionsProps } from '../media-core/media-block-view';
import { GraphicPreviewDialog } from '../rich-content/graphic-preview';
import { GraphicToolButton } from '../rich-content/frame/tool-button';
import { GraphicBlockResize } from '../rich-content/frame/graphic-resize';
import styles from './image.module.css';

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
          nodeView={props}
          alt={String(props.node.attrs.alt || source.name || '')}
        />
      )}
    />
  );
}

function ImageActions({ source, title, onReplace, nodeView }: MediaBlockActionsProps) {
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
      {onReplace && <BlockAlignmentMenu props={nodeView} />}
    </BlockActions>
    {visible && enlarged && <GraphicPreviewDialog presentation="image" src={source.url} title={title || t('image')} onClose={() => setEnlarged(false)} />}
  </>;
}

function ImagePreview({ src, alt, nodeView }: { src: string; alt: string; nodeView: NodeViewProps }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [failed, setFailed] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const editable = useEditorState({ editor: nodeView.editor, selector: ({ editor }) => editor.isEditable });
  const width = Number(nodeView.node.attrs.width || 100);
  const autoWidth = nodeView.node.attrs.autoWidth !== false;
  // Object URLs and user supplied hosts cannot use the Next image proxy.
  return failed ? (
    <span className="p-8 text-xs text-[var(--err-ink)]">
      {knowledgeT('unableToLoadImageCheckTheUrlOr')}
    </span>
  ) : <div className={styles.surface} data-image-surface data-graphic-auto-width={autoWidth} data-graphic-auto-height="true"
    style={{ width: autoWidth ? undefined : `${width}%`, '--image-natural-width': naturalWidth ? `${naturalWidth}px` : undefined } as CSSProperties}>
    {/* eslint-disable-next-line @next/next/no-img-element -- Object URLs bypass the image proxy. */}
    <img src={src} alt={alt} loading="lazy" draggable={false} onError={() => setFailed(true)} onLoad={event => {
      const image = event.currentTarget;
      if (image.naturalWidth && image.naturalHeight) setNaturalWidth(Math.min(image.naturalWidth, 640 * image.naturalWidth / image.naturalHeight));
    }} />
    {editable && <GraphicBlockResize props={nodeView} width={width} autoWidth={autoWidth} height={360} autoHeight minHeight={40}
      frameSelector="[data-image-surface]" proportional minWidthPixels={40} />}
  </div>;
}
