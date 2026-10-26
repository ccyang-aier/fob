'use client';

import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { DotsSixVertical } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { blockDragKey, createBlockDragPlugin } from '../extensions/block-drag';
import { blockDragMessages } from './block-drag-handle.messages';
import styles from './block-drag-handle.module.css';

/** One control layer shared by local, collaborative and folder document bodies. */
export function BlockDragHandle({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation(blockDragMessages);
  const handle = useRef<HTMLButtonElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editor) return;
    let registered = false;
    const unbind = () => {
      if (registered && !editor.isDestroyed) editor.unregisterPlugin(blockDragKey);
      registered = false;
    };
    const bind = () => {
      unbind();
      if (editor.isDestroyed || !editor.view.dom.isConnected || !handle.current || !indicator.current) return;
      editor.registerPlugin(createBlockDragPlugin({ handle: handle.current, indicator: indicator.current, sourceClass: styles.source, hoverClass: styles.hoverTarget, previewClass: styles.preview }));
      registered = true;
    };
    editor.on('mount', bind);
    editor.on('unmount', unbind);
    bind();
    return () => {
      editor.off('mount', bind);
      editor.off('unmount', unbind);
      unbind();
    };
  }, [editor]);
  return <>
    <button ref={handle} type="button" className={styles.handle} data-block-drag-handle draggable hidden aria-label={t('dragBlock')} title={t('dragBlock')}><DotsSixVertical size={16} /></button>
    <div ref={indicator} className={styles.indicator} data-block-drop-indicator hidden aria-hidden="true" />
  </>;
}
