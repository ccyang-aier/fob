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
import { DotsThree, Plus } from '@/components/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper, useEditorState } from '@tiptap/react';
import { selectTableAxis, tableNodeAt, type TableCommand } from './table-commands';
import { TableStyleMenu, type TableMenuAnchor } from './table-style-menu';
import { useTableGeometry } from './use-table-geometry';
import { useTableReorder } from './use-table-reorder';
import { useTableGrow } from './use-table-grow';
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
  const open = (axis: Axis, index: number) => {
    if (!geometry) return;
    setSelectionSource('axis');
    select(axis, index);
    setMenu({
      target: axis,
      side: axis === 'row' ? 'left' : 'top',
      style: axis === 'row'
        ? { left: geometry.viewportLeft - 12, top: geometry.top + (geometry.rows[index] + geometry.rows[index + 1]) / 2 - 12, width: 24, height: 24 }
        : { left: geometry.left + (geometry.columns[index] + geometry.columns[index + 1]) / 2 - 12, top: geometry.top - 12, width: 24, height: 24 },
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
    },
  });
  const grow = useTableGrow(editor, getPos, () => {
    clearResizeHover();
    setActive(true);
    setMenu(null);
  });

  const viewportWidth = geometry?.pageWidth ?? 1024;
  const toolbarWidth = Math.min(402, viewportWidth - 24, geometry ? geometry.contentRight - geometry.contentLeft - 16 : 402);
  const toolbarHeight = 39;
  const center =
    geometry && selection
      ? geometry.left + (geometry.columns[selection.left] + geometry.columns[selection.right]) / 2
      : 0;
  const toolbarLeft = geometry ? Math.max(
    Math.max(12, geometry.contentLeft + 8) + toolbarWidth / 2,
    Math.min(geometry.rootLeft + center, Math.min(viewportWidth - 12, geometry.contentRight - 8) - toolbarWidth / 2),
  ) : 0;
  const selectionTop = geometry && selection ? geometry.top + geometry.rows[selection.top] : 0;
  const selectionBottom =
    geometry && selection ? geometry.top + geometry.rows[selection.bottom] : 0;
  const selectionLeft = geometry && selection ? geometry.left + geometry.columns[selection.left] : 0;
  const selectionRight = geometry && selection ? geometry.left + geometry.columns[selection.right] : 0;
  const visibleSelectionLeft = geometry ? Math.max(selectionLeft, geometry.viewportLeft) : 0;
  const visibleSelectionRight = geometry ? Math.min(selectionRight, geometry.viewportLeft + geometry.viewportWidth) : 0;
  const selectionVisible =
    geometry &&
    geometry.rootTop + selectionBottom > geometry.contentTop &&
    geometry.rootTop + selectionTop < geometry.contentBottom;
  const above = geometry ? geometry.rootTop + selectionTop - toolbarHeight - 9 : 0;
  const toolbarTop = geometry ? Math.max(geometry.contentTop + 8, Math.min(
    above >= geometry.contentTop + 8 ? above : geometry.rootTop + selectionBottom + 9,
    geometry.contentBottom - toolbarHeight - 8,
  )) : 0;
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
      onMouseLeave={clearResizeHover}
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
      {editor.isEditable && geometry && selection && (active || menu) && visibleSelectionRight > visibleSelectionLeft ? (
        <div className={styles.selectionOutline} data-table-selection contentEditable={false} data-document-export-omit aria-hidden
          style={{
            left: visibleSelectionLeft - 1,
            top: selectionTop - 1,
            width: visibleSelectionRight - visibleSelectionLeft + 1,
            height: selectionBottom - selectionTop + 1,
            borderLeftWidth: selectionLeft < geometry.viewportLeft - 1 ? 0 : undefined,
            borderRightWidth: selectionRight > geometry.viewportLeft + geometry.viewportWidth + 1 ? 0 : undefined,
          }}
        />
      ) : null}
      {editor.isEditable && geometry ? (
        <div
          contentEditable={false}
          data-document-export-omit
          className={styles.controls}
          aria-label={knowledgeT('tableRowAndColumnControls')}
          onPointerEnter={clearResizeHover}
        >
          {(['column', 'row'] as const).map(axis => {
            const edges = axis === 'column' ? geometry.columns : geometry.rows;
            return edges.slice(0, -1).map((offset, index) => {
              const center = (offset + edges[index + 1]) / 2;
              if (axis === 'column' && (geometry.left + center < geometry.viewportLeft || geometry.left + center > geometry.viewportLeft + geometry.viewportWidth)) return null;
              const current = !!selection && index === (axis === 'column' ? selection.left : selection.top);
              const expanded = menu?.target === axis && current;
              const label = knowledgeT(axis === 'column' ? 'columnValueActions' : 'rowValueActions', { v0: index + 1 });
              return <Tooltip key={axis + index}>
                <TooltipTrigger asChild>
                  <button type="button" className={`fob-action ${styles.axisHandle}`} data-surface="plain"
                    data-axis={axis} data-current={current || undefined}
                    aria-label={label} aria-haspopup="menu" aria-expanded={expanded}
                    style={axis === 'column'
                      ? { left: geometry.left + center - 12, top: geometry.top - 12 }
                      : { left: geometry.viewportLeft - 12, top: geometry.top + center - 12 }}
                    onPointerDown={event => reorder.start(event, axis, index)}
                    onClick={() => { if (!reorder.suppressClick()) open(axis, index); }}>
                    <span className={styles.axisMark} aria-hidden />
                    <DotsThree size={14} className={styles.axisMore} aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side={axis === 'column' ? 'top' : 'left'}>{label}</TooltipContent>
              </Tooltip>;
            });
          })}
          {(['column', 'row'] as const).map(axis => {
            const isColumn = axis === 'column';
            const hint = knowledgeT(isColumn ? 'addColumnHint' : 'addRowHint');
            const growing = grow.growth?.axis === axis;
            const size = isColumn
              ? Math.max(90, geometry.columns[geometry.columns.length - 1] - geometry.columns[geometry.columns.length - 2])
              : Math.max(32, geometry.rows[geometry.rows.length - 1] - geometry.rows[geometry.rows.length - 2]);
            return <Tooltip key={axis}>
              <TooltipTrigger asChild>
                <button type="button" className={`fob-action ${styles.addTrack}`} data-surface="muted"
                  data-axis={axis} data-growing={growing || undefined}
                  aria-label={knowledgeT(isColumn ? 'addColumn' : 'addRow')}
                  style={isColumn
                    ? { left: geometry.viewportLeft + geometry.viewportWidth + 5, top: geometry.top, height: geometry.height }
                    : { left: geometry.viewportLeft, top: geometry.top + geometry.height + 5, width: geometry.viewportWidth }}
                  onMouseDown={event => event.preventDefault()}
                  onPointerDown={event => grow.start(event, axis, size)}
                  onClick={event => { if (event.detail === 0) grow.append(axis); }}>
                  <Plus size={16} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{hint}</TooltipContent>
            </Tooltip>;
          })}
          {grow.growth ? <div className={styles.growthPreview} data-axis={grow.growth.axis}
            style={grow.growth.axis === 'column'
              ? { left: geometry.viewportLeft + geometry.viewportWidth + 1, top: geometry.top, width: grow.growth.count * grow.growth.size, height: geometry.height, '--growth-step': `${grow.growth.size}px` } as CSSProperties
              : { left: geometry.viewportLeft, top: geometry.top + geometry.height + 1, width: geometry.viewportWidth, height: grow.growth.count * grow.growth.size, '--growth-step': `${grow.growth.size}px` } as CSSProperties}>
            <span className={styles.growthLabel} role="status">
              {knowledgeT('addCount', { count: grow.growth.count, axis: knowledgeT(grow.growth.axis === 'column' ? 'columns' : 'rows') })}
            </span>
          </div> : null}
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
      toolbarWidth >= 80 &&
      selection?.cells &&
      selectionSource === 'cells' &&
      !selectingCells &&
      !menu &&
      !reorder.drop &&
      !grow.growth ? (
        <TableSelectionToolbar
          editor={editor}
          tableId={node.attrs.blockId}
          run={run}
          background={selection.background}
          canComment={selection.canComment}
          style={{ left: toolbarLeft, top: toolbarTop, width: toolbarWidth }}
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
