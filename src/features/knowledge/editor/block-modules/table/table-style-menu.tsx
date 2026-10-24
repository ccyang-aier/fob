'use client';

import { useTranslation, createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './table-style-menu.messages';
import type { CSSProperties } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowLineDown,
  ArrowLineLeft,
  ArrowLineRight,
  ArrowLineUp,
  ArrowsInLineHorizontal,
  ArrowsOutLineHorizontal,
  CaretRight,
  Check,
  DownloadSimple,
  Palette,
  SortAscending,
  SortDescending,
  Table,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  Trash,
} from '@phosphor-icons/react';
import type { Editor } from '@tiptap/core';
import { mergeCells, splitCell } from '@tiptap/pm/tables';
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  deleteTable,
  moveTableAxis,
  sortTableColumn,
  tableNodeAt,
  toggleSelectedHeader,
  toggleAxisHeader,
  type TableCommand,
} from './table-commands';
import {
  setTableAlignment,
  setTableColor,
  type TableAlignment,
  type TableStyleTarget,
} from './table-style';
import styles from './table.module.css';
import { TableColorMenuItems } from './table-color-menu-items';
import { downloadTableCsv } from './table-csv';

export interface TableMenuAnchor {
  target: TableStyleTarget;
  style: CSSProperties;
  side: 'top' | 'left' | 'bottom';
}
function alignments(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    { value: 'left', label: knowledgeT('alignLeft'), icon: TextAlignLeft },
    { value: 'center', label: knowledgeT('alignCenter'), icon: TextAlignCenter },
    { value: 'right', label: knowledgeT('alignRight'), icon: TextAlignRight },
  ] as const;
}

export function TableStyleMenu({
  tableId,
  anchor,
  editor,
  run,
  onClose,
  align,
  background,
}: {
  tableId: string;
  anchor: TableMenuAnchor;
  editor: Editor;
  run: (command: TableCommand) => void;
  onClose: () => void;
  align: TableAlignment | null | undefined;
  background: string | null | undefined;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const target = anchor.target;
  const column = target === 'column';
  const row = target === 'row';
  const structure = row || column;
  const item = (label: string, Icon: typeof ArrowDown, command: TableCommand, danger = false) => (
    <Menu.Item
      className={`${styles.menuItem} fob-menu-item`}
      data-variant={danger ? 'destructive' : undefined}
      disabled={!command(editor.state)}
      onSelect={() => run(command)}
    >
      <Icon size={18} weight="bold" aria-hidden />
      <span>{label}</span>
    </Menu.Item>
  );
  return (
    <Menu.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label={knowledgeT('tableMenuAnchor')}
          tabIndex={-1}
          className={styles.menuAnchor}
          style={anchor.style}
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          data-fob-table-menu={tableId}
          className={styles.menu}
          aria-label={
            column
              ? knowledgeT('columnActions')
              : row
                ? knowledgeT('rowActions')
                : knowledgeT('tableActions')
          }
          side={anchor.side}
          align={row ? 'center' : 'start'}
          sideOffset={5}
          collisionPadding={12}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerDownOutside={onClose}
        >
          <Menu.Sub>
            <Menu.SubTrigger className={`${styles.menuItem} fob-menu-item`}>
              <TextAlignLeft size={18} weight="bold" aria-hidden />
              <span>{knowledgeT('alignment')}</span>
              <CaretRight size={12} weight="fill" className={styles.caret} aria-hidden />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent
                data-fob-table-menu={tableId}
                className={styles.menu}
                sideOffset={-8}
                alignOffset={0}
                collisionPadding={12}
                aria-label={knowledgeT('alignment')}
              >
                {alignments(locale).map(({ value, label, icon: Icon }) => (
                  <Menu.Item
                    key={value}
                    className={`${styles.menuItem} fob-menu-item`}
                    onSelect={() => run((s, d) => setTableAlignment(s, d, target, value))}
                  >
                    <Icon size={18} weight="bold" aria-hidden />
                    <span>{label}</span>
                    {align !== undefined && (align ?? 'left') === value ? (
                      <Check size={18} weight="bold" className={styles.caret} aria-hidden />
                    ) : null}
                  </Menu.Item>
                ))}
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          {column ? (
            <Menu.Sub>
              <Menu.SubTrigger
                className={`${styles.menuItem} fob-menu-item`}
                disabled={!sortTableColumn(editor.state, undefined, false)}
              >
                <SortAscending size={18} weight="bold" aria-hidden />
                <span>{knowledgeT('sort')}</span>
                <CaretRight size={12} weight="fill" className={styles.caret} aria-hidden />
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent
                  data-fob-table-menu={tableId}
                  className={styles.menu}
                  sideOffset={-8}
                  collisionPadding={12}
                  aria-label={knowledgeT('sort')}
                >
                  {item(knowledgeT('ascending'), SortAscending, (s, d) =>
                    sortTableColumn(s, d, false),
                  )}
                  {item(knowledgeT('descending'), SortDescending, (s, d) =>
                    sortTableColumn(s, d, true),
                  )}
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
          ) : null}
          <Menu.Sub>
            <Menu.SubTrigger className={`${styles.menuItem} fob-menu-item`}>
              <Palette size={18} weight="fill" aria-hidden />
              <span>{knowledgeT('background')}</span>
              <CaretRight size={12} weight="fill" className={styles.caret} aria-hidden />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent
                data-fob-table-menu={tableId}
                className={styles.menu}
                sideOffset={-8}
                collisionPadding={12}
                aria-label={knowledgeT('background')}
              >
                <TableColorMenuItems
                  tableId={tableId}
                  background={background}
                  onChange={(color) => run((s, d) => setTableColor(s, d, target, color))}
                />
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Separator className={styles.menuSeparator} />
          {item(
            knowledgeT('toggleHeader'),
            Table,
            structure
              ? (s, d) => toggleAxisHeader(s, d, column ? 'column' : 'row')
              : target === 'table'
                ? (s, d) => toggleAxisHeader(s, d, 'row')
                : toggleSelectedHeader,
          )}
          {structure ? (
            <>
              {item(knowledgeT('insertBefore'), column ? ArrowLineLeft : ArrowLineUp, (s, d) =>
                column ? addColumn(s, d, 'left') : addRow(s, d, 'above'),
              )}
              {item(knowledgeT('insertAfter'), column ? ArrowLineRight : ArrowLineDown, (s, d) =>
                column ? addColumn(s, d, 'right') : addRow(s, d, 'below'),
              )}
              {item(
                column ? knowledgeT('moveRight') : knowledgeT('moveDown'),
                column ? ArrowRight : ArrowDown,
                (s, d) => moveTableAxis(s, d, column ? 'column' : 'row', 1),
              )}
              {moveTableAxis(editor.state, undefined, column ? 'column' : 'row', -1)
                ? item(
                    column ? knowledgeT('moveLeft') : knowledgeT('moveUp'),
                    column ? ArrowLeft : ArrowUp,
                    (s, d) => moveTableAxis(s, d, column ? 'column' : 'row', -1),
                  )
                : null}
            </>
          ) : null}
          <Menu.Separator className={styles.menuSeparator} />
          {item(knowledgeT('mergeCells'), ArrowsInLineHorizontal, mergeCells)}
          {splitCell(editor.state)
            ? item(knowledgeT('splitCells'), ArrowsOutLineHorizontal, splitCell)
            : null}
          {target === 'table' ? (
            <>
              <Menu.Separator className={styles.menuSeparator} />
              <Menu.Item
                className={`${styles.menuItem} fob-menu-item`}
                onSelect={() => {
                  const hit = tableNodeAt(editor.state.selection.$from);
                  if (hit) downloadTableCsv(hit.table, editor.view.dom.ownerDocument);
                }}
              >
                <DownloadSimple size={18} weight="bold" aria-hidden />
                <span>{knowledgeT('exportCsv')}</span>
              </Menu.Item>
            </>
          ) : null}
          <Menu.Separator className={styles.menuSeparator} />
          {item(
            knowledgeT('delete'),
            Trash,
            target === 'table'
              ? deleteTable
              : row
                ? deleteRow
                : column
                  ? deleteColumn
                  : (s, d) => {
                      if (d) d(s.tr.deleteSelection());
                      return true;
                    },
            true,
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
