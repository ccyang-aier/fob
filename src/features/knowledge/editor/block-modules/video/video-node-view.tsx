'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './video-node-view.messages';
import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { MediaBlockView } from '../media-core/media-block-view';

export function VideoNodeView(
  props: NodeViewProps & { localKnowledgeBaseId?: string; knowledgeBaseId?: string },
) {
  return (
    <MediaBlockView
      {...props}
      kind="video"
      renderPreview={(source) => <VideoPreview key={source.url} src={source.url} />}
    />
  );
}

function VideoPreview({ src }: { src: string }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="p-8 text-xs text-[var(--err-ink)]">
      {knowledgeT('unableToPlayVideoCheckTheFormatOr')}
    </span>
  ) : (
    <video src={src} controls preload="metadata" onError={() => setFailed(true)} />
  );
}
