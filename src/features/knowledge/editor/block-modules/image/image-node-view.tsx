'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './image-node-view.messages';
import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { MediaBlockView } from '../media-core/media-block-view';

export function ImageNodeView(
  props: NodeViewProps & { localKnowledgeBaseId?: string; knowledgeBaseId?: string },
) {
  return (
    <MediaBlockView
      {...props}
      kind="image"
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
