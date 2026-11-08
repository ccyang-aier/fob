'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { DotsSixVertical, Plus } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { blockDragKey, createBlockDragPlugin } from '../../extensions/block-drag';
import { openBlockInsertMenu } from '../../commands/slash-paste';
import { blockDragMessages } from './messages';
import styles from './styles.module.css';
import { BlockMenu } from './menu';
import type { MenuBlock } from '../../extensions/block-menu';

/** One control layer shared by local, collaborative and folder document bodies. */
export function BlockDragHandle({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation(blockDragMessages);
  const handle = useRef<HTMLButtonElement>(null);
  const insertHandle = useRef<HTMLButtonElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const opened = useRef(false);
  const menuId = useId();
  const [menu, setMenu] = useState<MenuBlock | null>(null);
  const closeMenu = useCallback(() => { opened.current = false; setMenu(null); }, []);
  const emptyHint = t('emptyHint');
  useEffect(() => {
    if (!editor) return;
    let registered = false;
    const unbind = () => {
      if (registered && !editor.isDestroyed) editor.unregisterPlugin(blockDragKey);
      registered = false;
    };
    const bind = () => {
      unbind();
      if (editor.isDestroyed || !editor.view.dom.isConnected || !handle.current || !indicator.current || !insertHandle.current) return;
      editor.registerPlugin(createBlockDragPlugin({ handle: handle.current, indicator: indicator.current, sourceClass: styles.source, hoverClass: styles.hoverTarget, previewClass: styles.preview, insertHandle: insertHandle.current, emptyClass: styles.empty, emptyHint, onInsert: openBlockInsertMenu,
        isMenuOpen: () => opened.current, onMenuClose: closeMenu, menuAnchor: anchor.current ?? undefined,
        onMenu: (view, pos) => {
          if (opened.current) { closeMenu(); return; }
          const blockId = view.state.doc.nodeAt(pos)?.attrs.blockId;
          if (typeof blockId !== 'string') return;
          opened.current = true;
          if (view.state.doc.nodeAt(pos)?.type.name !== 'table')
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).setMeta('addToHistory', false));
          setMenu({ pos, blockId });
        },
      }));
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
  }, [editor, emptyHint, closeMenu]);
  return <>
    <button ref={handle} type="button" className={`fob-action ${styles.handle}`} data-block-drag-handle draggable hidden aria-label={t('blockMenu')} aria-haspopup="menu" aria-controls={menu ? menuId : undefined} aria-expanded={Boolean(menu)} title={t('dragBlock')}><DotsSixVertical size={16} /></button>
    <button ref={insertHandle} type="button" className={`fob-action ${styles.handle} ${styles.insert}`} data-block-insert-handle hidden aria-label={t('insertBlock')} title={t('insertBlock')}><Plus size={18} /></button>
    <div ref={indicator} className={styles.indicator} data-block-drop-indicator hidden aria-hidden="true" />
    {editor && <BlockMenu id={menuId} editor={editor} target={menu} anchor={anchor} handle={handle} onClose={closeMenu} />}
  </>;
}
