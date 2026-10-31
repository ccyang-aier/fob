'use client';

import { useState } from 'react';
import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { Emoji } from '@/components/icons';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { EmojiPalette } from '@/components/ui/emoji-picker/palette';
import { useTranslation } from '@/lib/i18n';
import { messages } from './emoji-node-view.messages';
import styles from './emoji.module.css';

export function EmojiNodeView({ node, editor, updateAttributes, HTMLAttributes }: NodeViewProps) {
  const { t } = useTranslation(messages);
  const editable = useEditorState({ editor, selector: ({ editor }) => editor.isEditable });
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const value = String(node.attrs.value);
  return <NodeViewWrapper {...HTMLAttributes} data-fob-node="emoji" data-emoji-block="" data-emoji-value={value}
    data-block-id={node.attrs.blockId} contentEditable={false} className={styles.root}>
    {editable ? <button type="button" className={`fob-action ${styles.trigger}`} data-surface="plain" data-document-export-text
      aria-label={t('changeEmojiValue', { v0: value })} title={t('changeEmoji')}
      aria-haspopup="dialog" aria-expanded={Boolean(anchor)} onMouseDown={event => event.preventDefault()}
      onClick={event => setAnchor(anchor ? null : event.currentTarget)}>
      <Emoji value={value} size={48} />
    </button> : <Emoji value={value} size={48} role="img" aria-label={value} aria-hidden={false} />}
    {editable && anchor && <AnchoredPopover anchor={anchor} label={t('changeEmoji')} width={296} onClose={() => setAnchor(null)}>
      <EmojiPalette value={value} onSelect={next => {
        if (!editor.isEditable) return;
        updateAttributes({ value: next });
        setAnchor(null);
      }} />
    </AnchoredPopover>}
  </NodeViewWrapper>;
}
