'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './audio-node-view.messages';
import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { MediaBlockView } from '../media-core/media-block-view';

export function AudioNodeView(
  props: NodeViewProps & { localKnowledgeBaseId?: string; knowledgeBaseId?: string },
) {
  return (
    <MediaBlockView
      {...props}
      kind="audio"
      renderPreview={(source) => <AudioPreview key={source.url} src={source.url} />}
    />
  );
}

function AudioPreview({ src }: { src: string }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="p-8 text-xs text-[var(--err-ink)]">
      {knowledgeT('unableToPlayAudioCheckTheFormatOr')}
    </span>
  ) : (
    <audio src={src} controls preload="metadata" onError={() => setFailed(true)} />
  );
}
