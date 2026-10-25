'use client';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './table-selection-toolbar.messages';
import { useRef, useState, type CSSProperties } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  ArrowsInLineHorizontal,
  ArrowsOutLineHorizontal,
  ChatText,
  Code,
  Link,
  Palette,
  TextB,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextItalic,
  TextStrikethrough,
  Triangle,
} from '@/components/icons';
import type { Editor } from '@tiptap/core';
import { mergeCells, splitCell } from '@tiptap/pm/tables';
import { safeKnowledgeUrl } from '@fob/shared/knowledge/schema';
import { requestSelectionComment } from '../../../comments/comment-compose-bridge';
import {
  tableSelectionHasMark,
  tableSelectionText,
  setTableSelectionHeading,
  setTableSelectionLink,
  toggleTableSelectionMark,
} from './table-selection-format';
import { setTableColor } from './table-style';
import { TableColorMenuItems } from './table-color-menu-items';
import type { TableCommand } from './table-commands';
import styles from './table.module.css';

function SelectionLink({
  editor,
  tableId,
  run,
}: {
  editor: Editor;
  tableId: string;
  run: (command: TableCommand) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <Menu.Root
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (next) {
          let value = '';
          for (const { node } of tableSelectionText(editor.state))
            node.descendants((child) => {
              const mark = child.marks.find((mark) => mark.type.name === 'link');
              if (mark && !value) value = mark.attrs.href;
            });
          setHref(value);
          setInvalid(false);
        }
        setOpen(next);
      }}
    >
      <Menu.Trigger asChild>
        <button
          type="button"
          className={styles.toolbarButton}
          aria-label={knowledgeT('setLink')}
          title={knowledgeT('setLink')}
          data-on={tableSelectionHasMark(editor.state, 'link') || undefined}
          disabled={!setTableSelectionLink(editor.state, undefined, null)}
        >
          <Link size={16} aria-hidden />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className={`${styles.menu} ${styles.linkMenu}`}
          data-fob-table-menu={tableId}
          sideOffset={8}
          collisionPadding={12}
          aria-label={knowledgeT('selectionLink')}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusCapture={(event) => {
            if (event.target === event.currentTarget) input.current?.focus();
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!safeKnowledgeUrl(href, 'link')) {
                setInvalid(true);
                return;
              }
              run((s, d) => setTableSelectionLink(s, d, href));
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') event.stopPropagation();
            }}
          >
            <label htmlFor={`table-link-${tableId}`} className={styles.linkLabel}>
              {knowledgeT('linkAddress')}
            </label>
            <input
              id={`table-link-${tableId}`}
              ref={input}
              className={styles.hexInput}
              value={href}
              onChange={(event) => {
                setHref(event.target.value);
                setInvalid(false);
              }}
              aria-invalid={invalid}
              placeholder="https://example.com"
            />
            {invalid ? (
              <p role="alert" className={styles.copyError}>
                {knowledgeT('enterAValidLinkAddress')}
              </p>
            ) : null}
            <div className={styles.linkActions}>
              <button
                type="button"
                onClick={() => {
                  run((s, d) => setTableSelectionLink(s, d, null));
                  setOpen(false);
                }}
              >
                {knowledgeT('removeLink')}
              </button>
              <button type="submit">{knowledgeT('apply')}</button>
            </div>
          </form>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function TableSelectionToolbar({
  editor,
  tableId,
  run,
  background,
  canComment,
  style,
}: {
  editor: Editor;
  tableId: string;
  run: (command: TableCommand) => void;
  background: string | null | undefined;
  canComment: boolean;
  style: CSSProperties;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const blocks = tableSelectionText(editor.state);
  const commentMark = editor.state.schema.marks.comment;
  const canAnchorComment =
    !!commentMark &&
    blocks.some(({ node }) => node.textContent && node.type.allowsMarkType(commentMark));
  const action = (label: string, Icon: typeof TextB, command: TableCommand, on = false) => (
    <button
      type="button"
      className={styles.toolbarButton}
      aria-label={label}
      title={label}
      aria-pressed={on}
      data-on={on || undefined}
      disabled={!command(editor.state)}
      onClick={() => run(command)}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
  const mark = (label: string, Icon: typeof TextB, name: string) =>
    action(
      label,
      Icon,
      (s, d) => toggleTableSelectionMark(s, d, name),
      tableSelectionHasMark(editor.state, name),
    );
  return (
    <div
      contentEditable={false}
      role="toolbar"
      aria-label={knowledgeT('selectedCellFormatting')}
      className={styles.selectionToolbar}
      style={style}
      onMouseDown={(event) => {
        if (event.currentTarget.contains(event.target as Node)) event.preventDefault();
      }}
    >
      <div className={styles.toolbarGroup}>
        {([TextHOne, TextHTwo, TextHThree] as const).map((Icon, index) => (
          <button
            key={index}
            type="button"
            className={styles.toolbarButton}
            aria-label={knowledgeT('headingValue', { v0: index + 1 })}
            title={knowledgeT('headingValue', { v0: index + 1 })}
            aria-pressed={
              blocks.length > 0 &&
              blocks.every(
                ({ node }) => node.type.name === 'heading' && node.attrs.level === index + 1,
              )
            }
            data-on={
              (blocks.length > 0 &&
                blocks.every(
                  ({ node }) => node.type.name === 'heading' && node.attrs.level === index + 1,
                )) ||
              undefined
            }
            disabled={!setTableSelectionHeading(editor.state, undefined, index + 1)}
            onClick={() => run((s, d) => setTableSelectionHeading(s, d, index + 1))}
          >
            <Icon size={16} aria-hidden />
          </button>
        ))}
      </div>
      <div className={styles.toolbarGroup}>
        {action(knowledgeT('mergeCells'), ArrowsInLineHorizontal, mergeCells)}
        {action(knowledgeT('splitCells'), ArrowsOutLineHorizontal, splitCell)}
      </div>
      <div className={styles.toolbarGroup}>
        {mark(knowledgeT('bold'), TextB, 'bold')}
        {mark(knowledgeT('italic'), TextItalic, 'italic')}
        {mark(knowledgeT('strikethrough'), TextStrikethrough, 'strike')}
        <Menu.Root modal={false}>
          <Menu.Trigger asChild>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label={knowledgeT('selectionBackground')}
              title={knowledgeT('selectionBackground')}
            >
              <Palette size={16} aria-hidden />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              data-fob-table-menu={tableId}
              className={styles.menu}
              aria-label={knowledgeT('selectionBackgroundColor')}
              sideOffset={8}
              collisionPadding={12}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <TableColorMenuItems
                tableId={tableId}
                background={background}
                onChange={(color) => run((s, d) => setTableColor(s, d, 'cell', color))}
              />
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        {mark(knowledgeT('inlineCode'), Code, 'code')}
      </div>
      <div className={styles.toolbarGroup}>
        <SelectionLink editor={editor} tableId={tableId} run={run} />
        <button
          type="button"
          className={styles.toolbarButton}
          aria-label={knowledgeT('commentOnSelection')}
          title={
            canComment
              ? knowledgeT('commentOnSelection')
              : knowledgeT('thisDocumentDoesNotSupportSelectionComments')
          }
          disabled={!canComment || !canAnchorComment}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            requestSelectionComment(editor, { x: bounds.left, y: bounds.bottom + 12 });
          }}
        >
          <ChatText size={16} aria-hidden />
        </button>
      </div>
      <Triangle className={styles.toolbarArrow} size={16} aria-hidden />
    </div>
  );
}
