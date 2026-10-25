'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './table-node-view.messages';
import type {
  CSSProperties,
  FC,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import { CellSelection, columnResizingPluginKey, selectedRect } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import { Plus } from '@/components/icons';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper, useEditorState } from '@tiptap/react';
import { insertTableAxis, selectTableAxis, tableNodeAt, type TableCommand } from './table-commands';
import { TableStyleMenu, type TableMenuAnchor } from './table-style-menu';
import { useTableGeometry } from './use-table-geometry';
import { useTableReorder } from './use-table-reorder';
import { TableSelectionToolbar } from './table-selection-toolbar';
import { canComposeSelectionComment } from '../../../comments/comment-compose-bridge';
import styles from './table.module.css';

const TableContent = NodeViewContent as unknown as FC<{
  as: 'table';
  className?: string;
  'data-variant'?: string;
  style?: CSSProperties;
}>;
type Axis = 'row' | 'column';
const uniform = <T,>(values: T[]): T | undefined =>
  values.every((value) => value === values[0]) ? values[0] : undefined;

export function TableNodeView({ node, editor, getPos, HTMLAttributes }: NodeViewProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const shellRef = useRef<HTMLDivElement>(null);
  const geometry = useTableGeometry(shellRef, node);
  const [menu, setMenu] = useState<TableMenuAnchor | null>(null);
  const [active, setActive] = useState(false);
  const [insertion, setInsertion] = useState<{ axis: Axis; index: number } | null>(null);
  const [selectionSource, setSelectionSource] = useState<'cells' | 'axis'>('cells');
  const [selectingCells, setSelectingCells] = useState(false);
  useEffect(() => {
    const ownerDocument = shellRef.current!.ownerDocument;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        shellRef.current?.parentElement?.contains(target) ||
        target.closest('[data-fob-table-menu]')?.getAttribute('data-fob-table-menu') ===
          node.attrs.blockId
      )
        return;
      setActive(false);
      setMenu(null);
      setInsertion(null);
    };
    ownerDocument.addEventListener('pointerdown', close);
    const finishSelection = () => setSelectingCells(false);
    ownerDocument.addEventListener('pointerup', finishSelection);
    ownerDocument.addEventListener('pointercancel', finishSelection);
    return () => {
      ownerDocument.removeEventListener('pointerdown', close);
      ownerDocument.removeEventListener('pointerup', finishSelection);
      ownerDocument.removeEventListener('pointercancel', finishSelection);
    };
  }, [node.attrs.blockId]);

  const selection = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const pos = getPos();
      const hit = tableNodeAt(current.state.selection.$from);
      if (!hit || hit.pos !== pos) return null;
      const rect = selectedRect(current.state);
      const selectedCells = rect.map.cellsInRect(rect).map((pos) => hit.table.nodeAt(pos)!);
      return {
        ...rect,
        map: undefined,
        table: undefined,
        cells: current.state.selection instanceof CellSelection,
        canComment: canComposeSelectionComment(current),
        rowsSelected:
          current.state.selection instanceof CellSelection &&
          current.state.selection.isRowSelection(),
        columnsSelected:
          current.state.selection instanceof CellSelection &&
          current.state.selection.isColSelection(),
        row: hit.row?.index,
        align: uniform(selectedCells.map((cell) => cell.attrs.align ?? 'left')),
        background: uniform(selectedCells.map((cell) => cell.attrs.background ?? null)),
        rowBackground: uniform(
          Array.from(
            { length: rect.bottom - rect.top },
            (_, index) => hit.table.child(rect.top + index).attrs.background ?? null,
          ),
        ),
      };
    },
  });

  const select = (axis: Axis | 'table', index: number, end = index) => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const tr = selectTableAxis(editor.state, pos, axis, index, end);
    if (tr) editor.view.dispatch(tr);
  };
  const run = (command: TableCommand) => {
    if (!editor.isEditable) return;
    editor.commands.command(({ state, dispatch }) => command(state, dispatch));
  };
  const clearResizeHover = () => {
    const resize = columnResizingPluginKey.getState(editor.state);
    if (resize && resize.activeHandle >= 0 && !resize.dragging)
      editor.view.dispatch(editor.state.tr.setMeta(columnResizingPluginKey, { setHandle: -1 }));
  };
  const open = (axis: Axis | 'table', index: number) => {
    if (!geometry) return;
    setSelectionSource('axis');
    select(axis, index);
    setInsertion(null);
    setMenu({
      target: axis,
      side: axis === 'row' ? 'left' : 'top',
      style:
        axis === 'row'
          ? {
              left: geometry.viewportLeft - 17,
              top: geometry.top + geometry.rows[index],
              width: 12,
              height: geometry.rows[index + 1] - geometry.rows[index],
            }
          : axis === 'column'
            ? {
                left: geometry.left + geometry.columns[index],
                top: geometry.top - 17,
                width: geometry.columns[index + 1] - geometry.columns[index],
                height: 12,
              }
            : { left: geometry.viewportLeft - 18, top: geometry.top - 18, width: 14, height: 14 },
    });
  };
  const reorder = useTableReorder({
    editor,
    getPos,
    shellRef,
    geometry,
    select,
    onStart: () => {
      setSelectionSource('axis');
      setMenu(null);
      setInsertion(null);
    },
  });
  const insert = (axis: Axis, index: number) => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    setInsertion(null);
    setMenu(null);
    run((state, dispatch) => insertTableAxis(state, dispatch, pos, axis, index));
    editor.view.focus();
  };

  const viewportWidth = geometry?.pageWidth ?? 1024;
  const toolbarWidth = Math.min(444, viewportWidth - 24);
  const toolbarHeight = 8 + 36 * Math.ceil(12 / Math.max(1, Math.floor((toolbarWidth - 12) / 36)));
  const center =
    geometry && selection
      ? geometry.left + (geometry.columns[selection.left] + geometry.columns[selection.right]) / 2
      : 0;
  const toolbarLeft = Math.max(
    12 + toolbarWidth / 2 - (geometry?.rootLeft ?? 0),
    Math.min(center, viewportWidth - 12 - toolbarWidth / 2 - (geometry?.rootLeft ?? 0)),
  );
  const selectionTop = geometry && selection ? geometry.top + geometry.rows[selection.top] : 0;
  const selectionBottom =
    geometry && selection ? geometry.top + geometry.rows[selection.bottom] : 0;
  const selectionVisible =
    geometry &&
    geometry.rootTop + selectionBottom > 0 &&
    geometry.rootTop + selectionTop < geometry.pageHeight;
  const toolbarTop = geometry
    ? Math.max(
        12 + toolbarHeight / 2 - geometry.rootTop,
        Math.min(
          (selectionTop + selectionBottom) / 2,
          geometry.pageHeight - 12 - toolbarHeight / 2 - geometry.rootTop,
        ),
      )
    : 0;
  const dropLeft =
    geometry && reorder.drop
      ? reorder.drop.axis === 'column'
        ? geometry.left + geometry.columns[reorder.drop.boundary]
        : geometry.viewportLeft - 17
      : 0;
  return (
    <NodeViewWrapper
      as="div"
      {...HTMLAttributes}
      data-fob-node="table"
      data-block-id={node.attrs.blockId}
      data-active={(active && !!selection) || !!menu || undefined}
      data-reordering={!!reorder.drop || undefined}
      className={styles.root}
      onPointerDownCapture={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (!editor.isEditable) return;
        setActive(true);
        if (event.target instanceof Element && event.target.closest('td,th')) {
          setSelectionSource('cells');
          setSelectingCells(true);
          setMenu(null);
        }
      }}
      onMouseLeave={() => {
        setInsertion(null);
        clearResizeHover();
      }}
      onDragStart={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (selectingCells && event.target instanceof Element && event.target.closest('td,th'))
          event.preventDefault();
      }}
      onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (!editor.isEditable || !(event.target instanceof Element)) return;
        const cell = event.target.closest('td,th');
        if (!(cell instanceof HTMLTableCellElement)) return;
        event.preventDefault();
        const pos = editor.view.posAtDOM(cell, 0);
        if (
          !(editor.state.selection instanceof CellSelection) ||
          !cell.classList.contains('selectedCell')
        ) {
          editor.view.dispatch(
            editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos))),
          );
        }
        const bounds = shellRef.current!.parentElement!.getBoundingClientRect();
        setMenu({
          target: 'cell',
          side: 'bottom',
          style: {
            left: event.clientX - bounds.left,
            top: event.clientY - bounds.top,
            width: 1,
            height: 1,
          },
        });
      }}
    >
      <div ref={shellRef} className={styles.shell}>
        <TableContent
          as="table"
          className={styles.table}
          data-variant={node.attrs.variant}
          style={{ backgroundColor: node.attrs.background ?? undefined }}
        />
      </div>
      {editor.isEditable && geometry && active && (selection || menu) ? (
        <div
          contentEditable={false}
          data-document-export-omit
          className={styles.controls}
          aria-label={knowledgeT('tableRowAndColumnControls')}
          onPointerEnter={clearResizeHover}
        >
          <button
            type="button"
            className={styles.corner}
            aria-label={knowledgeT('selectWholeTable')}
            aria-haspopup="menu"
            aria-pressed={!!selection?.rowsSelected && !!selection?.columnsSelected}
            data-selected={(selection?.rowsSelected && selection?.columnsSelected) || undefined}
            style={{ left: geometry.viewportLeft - 18, top: geometry.top - 18 }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => open('table', 0)}
          />
          <div
            className={styles.columnRail}
            style={{
              left: geometry.viewportLeft,
              top: geometry.top - 17,
              width: geometry.viewportWidth,
            }}
          >
            {geometry.columns.slice(0, -1).map((left, index) => (
              <button
                key={index}
                type="button"
                className={styles.columnHandle}
                aria-label={knowledgeT('columnValueActions', { v0: index + 1 })}
                aria-haspopup="menu"
                aria-expanded={
                  menu?.target === 'column' && menu.style.left === geometry.left + left
                }
                data-selected={
                  (selectionSource === 'axis' &&
                    selection?.columnsSelected &&
                    index >= selection.left &&
                    index < selection.right) ||
                  undefined
                }
                style={{
                  left: geometry.left - geometry.viewportLeft + left,
                  width: geometry.columns[index + 1] - left,
                }}
                onPointerDown={(event) => reorder.start(event, 'column', index)}
                onClick={() => {
                  if (!reorder.suppressClick()) open('column', index);
                }}
              />
            ))}
          </div>
          <div
            className={styles.rowRail}
            style={{ left: geometry.viewportLeft - 17, top: geometry.top, height: geometry.height }}
          >
            {geometry.rows.slice(0, -1).map((top, index) => (
              <button
                key={index}
                type="button"
                className={styles.rowHandle}
                aria-label={knowledgeT('rowValueActions', { v0: index + 1 })}
                aria-haspopup="menu"
                aria-expanded={menu?.target === 'row' && menu.style.top === geometry.top + top}
                data-selected={
                  (selectionSource === 'axis' &&
                    selection?.rowsSelected &&
                    index >= selection.top &&
                    index < selection.bottom) ||
                  undefined
                }
                style={{ top, height: geometry.rows[index + 1] - top }}
                onPointerDown={(event) => reorder.start(event, 'row', index)}
                onClick={() => {
                  if (!reorder.suppressClick()) open('row', index);
                }}
              />
            ))}
          </div>
          {(['column', 'row'] as const).map((axis) =>
            (axis === 'column' ? geometry.columns : geometry.rows).map((offset, index) =>
              axis === 'column' &&
              (geometry.left + offset < geometry.viewportLeft - 1 ||
                geometry.left + offset >
                  geometry.viewportLeft + geometry.viewportWidth + 1) ? null : (
                <button
                  key={axis + index}
                  type="button"
                  className={styles.insertButton}
                  aria-label={knowledgeT('insertAtValuePositionValue', {
                    v0: index + 1,
                    v1: axis === 'column' ? knowledgeT('columns') : knowledgeT('rows'),
                  })}
                  data-active={(insertion?.axis === axis && insertion.index === index) || undefined}
                  style={
                    axis === 'column'
                      ? { left: geometry.left + offset - 10, top: geometry.top - 40 }
                      : { left: geometry.viewportLeft - 40, top: geometry.top + offset - 10 }
                  }
                  onPointerEnter={() => {
                    if (!menu && !reorder.drop) setInsertion({ axis, index });
                  }}
                  onPointerLeave={() => setInsertion(null)}
                  onFocus={() => setInsertion({ axis, index })}
                  onBlur={() => setInsertion(null)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insert(axis, index)}
                >
                  <span className={styles.boundaryDot} />
                  <Plus size={16} aria-hidden />
                </button>
              ),
            ),
          )}
          {insertion ? (
            <div
              aria-hidden
              className={styles.insertLine}
              data-axis={insertion.axis}
              style={
                insertion.axis === 'column'
                  ? {
                      left: geometry.left + geometry.columns[insertion.index],
                      top: geometry.top - 30,
                      height: geometry.height + 30,
                    }
                  : {
                      left: geometry.viewportLeft - 30,
                      top: geometry.top + geometry.rows[insertion.index],
                      width: geometry.viewportWidth + 30,
                    }
              }
            />
          ) : null}
          {reorder.drop ? (
            <div
              className={styles.dropLine}
              data-axis={reorder.drop.axis}
              data-invalid={!reorder.drop.valid || undefined}
              style={
                reorder.drop.axis === 'column'
                  ? {
                      left: geometry.left + geometry.columns[reorder.drop.boundary],
                      top: geometry.top - 17,
                      height: geometry.height + 17,
                    }
                  : {
                      left: geometry.viewportLeft - 17,
                      top: geometry.top + geometry.rows[reorder.drop.boundary],
                      width: geometry.viewportWidth + 17,
                    }
              }
            >
              <span
                className={styles.dropLabel}
                data-left={geometry.rootLeft + dropLeft > geometry.pageWidth - 140 || undefined}
                role="status"
              >
                {reorder.drop.valid
                  ? knowledgeT('moveToThisValuePosition', {
                      v0: reorder.drop.axis === 'row' ? knowledgeT('rows') : knowledgeT('columns'),
                    })
                  : knowledgeT('cannotDropHere')}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {editor.isEditable &&
      active &&
      geometry &&
      selectionVisible &&
      selection?.cells &&
      selectionSource === 'cells' &&
      !selectingCells &&
      !menu &&
      !reorder.drop ? (
        <TableSelectionToolbar
          editor={editor}
          tableId={node.attrs.blockId}
          run={run}
          background={selection.background}
          canComment={selection.canComment}
          style={{ left: toolbarLeft, top: toolbarTop }}
        />
      ) : null}
      {menu ? (
        <TableStyleMenu
          tableId={node.attrs.blockId}
          anchor={menu}
          editor={editor}
          run={run}
          onClose={() => setMenu(null)}
          align={selection ? selection.align : null}
          background={
            menu.target === 'row'
              ? selection?.rowBackground
              : menu.target === 'table'
                ? node.attrs.background
                : selection?.background
          }
        />
      ) : null}
    </NodeViewWrapper>
  );
}
