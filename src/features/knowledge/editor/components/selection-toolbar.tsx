'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './selection-toolbar.messages';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import {
  Chat,
  Code,
  Highlighter,
  LinkSimple,
  ListBullets,
  ListChecks,
  ListNumbers,
  Quotes,
  TextB,
  TextItalic,
  TextStrikethrough,
} from '@/components/icons';
import { safeKnowledgeUrl } from '@fob/shared/knowledge/schema';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getOverlayRoot } from '@/lib/overlay-root';
import {
  canComposeSelectionComment,
  requestSelectionComment,
} from '../../comments/comment-compose-bridge';
import {
  currentBlockFormat,
  setBlockFormat,
  type BlockFormat,
} from '../extensions/format/block-format';
import styles from './selection-toolbar.module.css';

function SelectionLink({
  editor,
  onOpenChange,
}: {
  editor: Editor;
  onOpenChange: (open: boolean) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  const [invalid, setInvalid] = useState(false);
  const selection = useRef({ from: 0, to: 0 });
  const apply = (url: string | null) => {
    const chain = editor.chain().focus().setTextSelection(selection.current);
    if (url) chain.setMark('link', { href: url });
    else chain.unsetMark('link');
    chain.run();
    setOpen(false);
    onOpenChange(false);
  };
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(value) => {
        if (value) {
          selection.current = { from: editor.state.selection.from, to: editor.state.selection.to };
          setHref(editor.getAttributes('link').href ?? '');
          setInvalid(false);
        }
        onOpenChange(value);
        setOpen(value);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={styles.tool}
          aria-label={knowledgeT('setLink')}
          title={knowledgeT('link')}
          aria-pressed={editor.isActive('link')}
        >
          <LinkSimple size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-selection-link
        align="end"
        side="bottom"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        <form
          className={styles.linkForm}
          onSubmit={(event) => {
            event.preventDefault();
            const url = safeKnowledgeUrl(href.trim(), 'link');
            if (!url) {
              setInvalid(true);
              return;
            }
            apply(url);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') event.stopPropagation();
          }}
        >
          <label>
            {knowledgeT('linkAddress')}
            <input
              autoFocus
              aria-label={knowledgeT('documentLinkUrl')}
              placeholder="https://"
              value={href}
              onChange={(event) => {
                setHref(event.target.value);
                setInvalid(false);
              }}
              aria-invalid={invalid}
            />
          </label>
          {invalid && <p role="alert">{knowledgeT('enterAValidSafeLinkAddress')}</p>}
          <div>
            <button type="button" onClick={() => apply(null)}>
              {knowledgeT('removeLink')}
            </button>
            <button type="submit">{knowledgeT('apply')}</button>
          </div>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The shared text-selection surface uses the editor's existing format commands. */
export function SelectionToolbar({ editor }: { editor: Editor | null }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const toolbar = useRef<HTMLDivElement>(null);
  const linkOpen = useRef(false);
  const [position, setPosition] = useState<{ x: number; y: number; maxWidth: number } | null>(null);
  const refresh = useCallback(() => {
    if (
      !editor ||
      editor.isDestroyed ||
      !editor.isEditable ||
      !(editor.state.selection instanceof TextSelection) ||
      editor.state.selection.empty
    ) {
      linkOpen.current = false;
      setPosition(null);
      return;
    }
    const active = document.activeElement;
    const inTools =
      active instanceof Element &&
      (toolbar.current?.contains(active) || active.closest('[data-selection-link]'));
    if (!editor.isFocused && !inTools && !linkOpen.current) {
      setPosition(null);
      return;
    }
    const scroll = editor.view.dom.closest('[data-document-scroll]')?.getBoundingClientRect();
    if (!scroll) return;
    const start = editor.view.coordsAtPos(editor.state.selection.from);
    const end = editor.view.coordsAtPos(editor.state.selection.to, -1);
    if (end.bottom < scroll.top || start.top > scroll.bottom) {
      linkOpen.current = false;
      setPosition(null);
      return;
    }
    const comments = editor.view.dom
      .closest('[data-knowledge-editor]')
      ?.querySelector('[data-knowledge-comments]')
      ?.getBoundingClientRect();
    const edge = comments && comments.left < scroll.right ? comments.left : scroll.right;
    const maxWidth = Math.min(edge - scroll.left - 16, window.innerWidth - 24);
    if (maxWidth < 80) {
      linkOpen.current = false;
      setPosition(null);
      return;
    }
    const width = Math.min(toolbar.current?.offsetWidth || 460, maxWidth);
    const height = toolbar.current?.offsetHeight || 39;
    const left = Math.max(12, scroll.left + 8);
    const right = Math.min(window.innerWidth - 12, edge - 8);
    const x = Math.min(Math.max((start.left + end.right) / 2 - width / 2, left), right - width);
    const above = start.top - height - 9;
    const y =
      above >= scroll.top + 8 ? above : Math.min(end.bottom + 9, scroll.bottom - height - 8);
    setPosition({ x, y, maxWidth });
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    let detach = () => {};
    const bind = () => {
      detach();
      if (editor.isDestroyed) return;
      const scroll = editor.view.dom.closest('[data-document-scroll]');
      const blur = () => requestAnimationFrame(refresh);
      editor.on('transaction', refresh);
      editor.on('focus', refresh);
      editor.on('blur', blur);
      scroll?.addEventListener('scroll', refresh, { passive: true });
      const observer = new ResizeObserver(refresh);
      if (scroll) observer.observe(scroll);
      window.addEventListener('resize', refresh);
      document.addEventListener('fullscreenchange', refresh);
      detach = () => {
        editor.off('transaction', refresh);
        editor.off('focus', refresh);
        editor.off('blur', blur);
        scroll?.removeEventListener('scroll', refresh);
        window.removeEventListener('resize', refresh);
        observer.disconnect();
        document.removeEventListener('fullscreenchange', refresh);
      };
    };
    const unbind = () => {
      detach();
      refresh();
    };
    editor.on('mount', bind);
    editor.on('unmount', unbind);
    bind();
    return () => {
      editor.off('mount', bind);
      editor.off('unmount', unbind);
      detach();
    };
  }, [editor, refresh]);
  if (!position || !editor?.isEditable) return null;
  const format = currentBlockFormat(editor.state);
  const block = (value: BlockFormat) => editor.chain().focus().command(setBlockFormat(value)).run();
  const isBlock = (kind: BlockFormat['kind'], level?: number) =>
    format?.kind === kind &&
    (kind !== 'heading' || (format.kind === 'heading' && format.level === level));
  return createPortal(
    <div
      ref={toolbar}
      role="toolbar"
      aria-label={knowledgeT('selectedTextActions')}
      className={styles.toolbar}
      style={{ left: position.x, top: position.y, maxWidth: position.maxWidth }}
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          editor.commands.focus();
          setPosition(null);
        }
      }}
    >
      <div className={styles.group}>
        {[1, 2, 3].map((level) => (
          <button
            key={level}
            type="button"
            className={styles.tool}
            aria-label={knowledgeT('headingHValue', { v0: level })}
            title={knowledgeT('headingHValue', { v0: level })}
            aria-pressed={isBlock('heading', level)}
            onClick={() => block({ kind: 'heading', level })}
          >
            H{level}
          </button>
        ))}
        <button
          type="button"
          className={styles.tool}
          aria-label={knowledgeT('blockquote')}
          title={knowledgeT('quote')}
          aria-pressed={isBlock('blockquote')}
          onClick={() => block({ kind: 'blockquote' })}
        >
          <Quotes size={16} />
        </button>
      </div>
      <div className={styles.group}>
        {(
          [
            { kind: 'taskList', label: knowledgeT('taskList'), Icon: ListChecks },
            { kind: 'bulletList', label: knowledgeT('bulletList'), Icon: ListBullets },
            { kind: 'orderedList', label: knowledgeT('numberedList'), Icon: ListNumbers },
          ] as const
        ).map(({ kind, label, Icon }) => (
          <button
            key={kind}
            type="button"
            className={styles.tool}
            aria-label={label}
            title={label}
            aria-pressed={isBlock(kind)}
            onClick={() => block({ kind })}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
      <div className={styles.group}>
        {(
          [
            { mark: 'bold', label: knowledgeT('bold'), Icon: TextB },
            { mark: 'italic', label: knowledgeT('italic'), Icon: TextItalic },
            { mark: 'strike', label: knowledgeT('strikethrough'), Icon: TextStrikethrough },
            { mark: 'highlight', label: knowledgeT('highlight'), Icon: Highlighter },
            { mark: 'code', label: knowledgeT('inlineCode'), Icon: Code },
          ] as const
        ).map(({ mark, label, Icon }) => (
          <button
            key={mark}
            type="button"
            className={styles.tool}
            aria-label={label}
            title={label}
            aria-pressed={editor.isActive(mark)}
            disabled={!editor.can().toggleMark(mark)}
            onClick={() => editor.chain().focus().toggleMark(mark).run()}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
      <div className={styles.group}>
        <SelectionLink
          editor={editor}
          onOpenChange={(open) => {
            linkOpen.current = open;
            if (!open) requestAnimationFrame(refresh);
          }}
        />
        {canComposeSelectionComment(editor) && (
          <button
            type="button"
            className={styles.tool}
            aria-label={knowledgeT('commentOnSelection')}
            title={knowledgeT('comments')}
            onClick={() =>
              requestSelectionComment(editor, {
                x: position.x + Math.min(460, position.maxWidth) / 2,
                y: editor.view.coordsAtPos(editor.state.selection.from).top,
              })
            }
          >
            <Chat size={16} />
          </button>
        )}
      </div>
    </div>,
    getOverlayRoot() ?? document.body,
  );
}
