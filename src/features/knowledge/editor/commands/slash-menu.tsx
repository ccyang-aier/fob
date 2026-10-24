'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './slash-menu.messages';
/**
 * The '/' floating menu (E06): a thin React view over the `fobSlashMenu`
 * plugin state. Every behavior decision — open/close, query, keyboard
 * highlight, running an item — lives in the plugin; this layer only positions
 * and renders. The menu portals to the overlay root, never takes focus
 * (keyboard stays in the editor), follows the caret of the '/query' trigger,
 * and renders the registry-backed commands as a compact block picker.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { getOverlayRoot } from '@/lib/overlay-root';
import { cn } from '@/lib/utils';
import { filterSlashItems } from './slash-items';
import {
  closeSlashMenu,
  runSlashItem,
  setActiveSlashItem,
  slashItemsOfEditor,
  slashMenuPluginKey,
} from './slash-paste';
import styles from './slash-menu.module.css';

const MENU_WIDTH = 240;
const MENU_MAX_HEIGHT = 324;
const VIEWPORT_MARGIN = 8;

interface OpenMenuState {
  range: { from: number; to: number };
  query: string;
  active: number;
}

export function SlashMenuLayer({ editor }: { editor: Editor | null }) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  // Keyed by editor: a stale editor's menu never renders after a scope switch
  // (derived, not reset in an effect).
  const [menuState, setMenuState] = useState<{ editor: Editor | null; menu: OpenMenuState | null }>(
    { editor: null, menu: null },
  );
  const menu = menuState.editor === editor ? menuState.menu : null;
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerInsideRef = useRef(false);

  // The plugin state is the single source; every editor transaction re-reads it.
  useLayoutEffect(() => {
    if (!editor) return undefined;
    const read = () => {
      const state = slashMenuPluginKey.getState(editor.state);
      setMenuState({
        editor,
        menu:
          state?.open && state.range
            ? { range: state.range, query: state.query, active: state.active }
            : null,
      });
    };
    read();
    editor.on('transaction', read);
    return () => {
      editor.off('transaction', read);
    };
  }, [editor]);

  // Blur closes the menu — unless the pointer is choosing inside it.
  useEffect(() => {
    if (!editor || !menu) return undefined;
    const onBlur = () => {
      if (!pointerInsideRef.current) closeSlashMenu(editor.view);
    };
    editor.on('blur', onBlur);
    return () => {
      editor.off('blur', onBlur);
    };
  }, [editor, menu]);

  const items = useMemo(() => (editor ? slashItemsOfEditor(editor) : []), [editor]);
  const filtered = useMemo(
    () => filterSlashItems(items, menu?.query ?? '', locale),
    [items, menu?.query, locale],
  );
  const activeIndex = Math.min(menu?.active ?? 0, filtered.length - 1);
  const activeItem = activeIndex >= 0 ? filtered[activeIndex] : null;

  // Position at the caret (viewport coords), clamped and flipped above when
  // near the bottom. The panel renders hidden first; measuring then revealing
  // is imperative because React never re-manages this style after mount.
  useLayoutEffect(() => {
    if (!editor || !menu) return;
    const panel = panelRef.current;
    if (!panel) return;
    let coords: { left: number; top: number; bottom: number };
    try {
      coords = editor.view.coordsAtPos(menu.range.from);
    } catch {
      closeSlashMenu(editor.view);
      return;
    }
    const height = Math.min(panel.offsetHeight, MENU_MAX_HEIGHT);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, coords.left),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    );
    const below = coords.bottom + 6;
    const top =
      below + height + VIEWPORT_MARGIN > window.innerHeight
        ? Math.max(VIEWPORT_MARGIN, coords.top - height - 6)
        : below;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.visibility = 'visible';
  }, [editor, menu]);

  // Keep the highlighted item inside the scroll viewport.
  useEffect(() => {
    if (!menu) return;
    panelRef.current
      ?.querySelector('[data-slash-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [menu, activeItem]);

  // The editor's contenteditable owns the menu semantics for screen readers.
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => {
      if (editor.isDestroyed) return;
      const dom = editor.view.dom;
      if (menu && activeItem)
        dom.setAttribute('aria-activedescendant', `fob-slash-item-${activeItem.name}`);
      else dom.removeAttribute('aria-activedescendant');
    };
    update();
    editor.on('create', update);
    return () => {
      editor.off('create', update);
      if (!editor.isDestroyed) editor.view.dom.removeAttribute('aria-activedescendant');
    };
  }, [editor, menu, activeItem]);

  if (!editor || typeof document === 'undefined') return null;

  return createPortal(
    <>
      {menu ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label={knowledgeT('insertBlock')}
          style={{ visibility: 'hidden', width: MENU_WIDTH }}
          onMouseEnter={() => {
            pointerInsideRef.current = true;
          }}
          onMouseLeave={() => {
            pointerInsideRef.current = false;
          }}
          className={styles.menu}
        >
          {filtered.length === 0 ? (
            <p className={styles.empty}>{knowledgeT('noMatchingBlocks')}</p>
          ) : (
            filtered.map((item, index) => {
              const active = item === activeItem;
              const Icon = item.icon;
              const separated =
                index > 0 &&
                (item.name === 'taskList' ||
                  item.name === 'image' ||
                  item.group !== filtered[index - 1]?.group);
              return (
                <button
                  key={item.name}
                  id={`fob-slash-item-${item.name}`}
                  type="button"
                  role="menuitem"
                  data-slash-active={active || undefined}
                  data-highlighted={active ? '' : undefined}
                  // mousedown would drag focus out of the editor; the click still lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSlashItem(editor.view, index)}
                  onClick={() => runSlashItem(editor.view, item)}
                  className={cn('fob-menu-item', styles.item, separated && styles.separated)}
                >
                  {item.marker ? (
                    <span aria-hidden className={styles.marker}>
                      {item.marker}
                    </span>
                  ) : Icon ? (
                    <Icon aria-hidden className={styles.icon} />
                  ) : null}
                  <span className={styles.title}>{item.title}</span>
                  {item.shortcut ? (
                    <span aria-hidden className={styles.shortcut}>
                      {item.shortcut}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </>,
    getOverlayRoot() ?? document.body,
  );
}
