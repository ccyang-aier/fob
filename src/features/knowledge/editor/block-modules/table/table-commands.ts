import { getLocale } from '@/lib/i18n';
import type { Command } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import {
  addColumnAfter,
  addColumnBefore,
  CellSelection,
  deleteColumn as removeColumn,
  deleteRow as removeRow,
  deleteTable as removeWholeTable,
  TableMap,
  toggleHeader,
  toggleHeaderCell,
  addRow as insertRowAt,
  addColumn as insertColumnAt,
  selectedRect,
} from '@tiptap/pm/tables';

import { moveTableAxisTo } from './table-move';

export type RowWhere = 'above' | 'below';
export type ColumnWhere = 'left' | 'right';
export type TableCommand = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;
export interface TableHit {
  table: ProseMirrorNode;
  pos: number;
  row: { node: ProseMirrorNode; pos: number; index: number } | null;
  cell: { node: ProseMirrorNode; pos: number; index: number; column: number } | null;
}

export function tableNodeAt($pos: ResolvedPos): TableHit | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const table = $pos.node(depth);
    if (table.type.spec.tableRole !== 'table') continue;
    const pos = $pos.before(depth);
    const hit: TableHit = { table, pos, row: null, cell: null };
    for (let inner = depth + 1; inner <= $pos.depth; inner++) {
      const node = $pos.node(inner);
      if (node.type.spec.tableRole === 'row')
        hit.row = { node, pos: $pos.before(inner), index: $pos.index(inner - 1) };
      if (['cell', 'header_cell'].includes(node.type.spec.tableRole ?? '')) {
        const cellPos = $pos.before(inner);
        hit.cell = {
          node,
          pos: cellPos,
          index: $pos.index(inner - 1),
          column: TableMap.get(table).findCell(cellPos - pos - 1).left,
        };
      }
    }
    return hit;
  }
  return null;
}

export const addRow = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  where: RowWhere = 'below',
) => {
  const hit = tableNodeAt(state.selection.$from);
  if (!hit?.row) return false;
  const rect = selectedRect(state);
  return insertTableAxis(
    state,
    dispatch,
    hit.pos,
    'row',
    where === 'above' ? rect.top : rect.bottom,
  );
};
export const addColumn = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
  where: ColumnWhere = 'right',
) => (where === 'left' ? addColumnBefore : addColumnAfter)(state, dispatch);
export const deleteRow: TableCommand = (state, dispatch) => {
  if (!tableNodeAt(state.selection.$from)) return false;
  const rect = selectedRect(state);
  return rect.top === 0 && rect.bottom === rect.map.height
    ? removeWholeTable(state, dispatch)
    : removeRow(state, dispatch);
};
export const deleteColumn: TableCommand = (state, dispatch) => {
  if (!tableNodeAt(state.selection.$from)) return false;
  const rect = selectedRect(state);
  return rect.left === 0 && rect.right === rect.map.width
    ? removeWholeTable(state, dispatch)
    : removeColumn(state, dispatch);
};
export const deleteTable: TableCommand = removeWholeTable;
export const toggleHeaderRow: TableCommand = toggleHeader('row');

/** Rail selections cover complete logical rows/columns, including spanning cells. */
export function selectTableAxis(
  state: EditorState,
  pos: number,
  axis: 'row' | 'column' | 'table',
  index: number,
  end = index,
): Transaction | null {
  const table = state.doc.nodeAt(pos);
  if (table?.type.spec.tableRole !== 'table') return null;
  const map = TableMap.get(table);
  const start = pos + 1;
  if (!map.width || !map.height) return null;
  const first =
    axis === 'row'
      ? map.map[Math.min(index, map.height - 1) * map.width]
      : axis === 'column'
        ? map.map[Math.min(index, map.width - 1)]
        : map.map[0];
  const last =
    axis === 'row'
      ? map.map[Math.min(end, map.height - 1) * map.width + map.width - 1]
      : axis === 'column'
        ? map.map[(map.height - 1) * map.width + Math.min(end, map.width - 1)]
        : map.map.at(-1)!;
  return state.tr.setSelection(CellSelection.create(state.doc, start + first, start + last));
}

export const toggleSelectedHeader: TableCommand = toggleHeaderCell;

export function toggleAxisHeader(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  axis: 'row' | 'column',
): boolean {
  if (axis === 'row') return toggleHeaderRow(state, dispatch);
  const hit = tableNodeAt(state.selection.$from);
  if (!hit?.cell) return false;
  const rect = selectedRect(state);
  const fixedHeader = hasHeaderRow(hit.table);
  const positions = rect.map.cellsInRect({
    top: fixedHeader ? 1 : 0,
    bottom: rect.map.height,
    left: rect.left,
    right: rect.right,
  });
  if (!positions.length) return false;
  const enable = positions.some((pos) => hit.table.nodeAt(pos)!.type.spec.tableRole === 'cell');
  if (dispatch) {
    const tr = state.tr;
    for (const relative of positions) {
      const cell = hit.table.nodeAt(relative)!;
      tr.setNodeMarkup(
        hit.pos + 1 + relative,
        enable ? state.schema.nodes.tableHeader : state.schema.nodes.tableCell,
        cell.attrs,
      );
    }
    dispatch(tr);
  }
  return true;
}

export function hasHeaderRow(table: ProseMirrorNode): boolean {
  return (
    !!table.firstChild?.childCount &&
    Array.from({ length: table.firstChild.childCount }, (_, i) => table.firstChild!.child(i)).every(
      (cell) => cell.type.spec.tableRole === 'header_cell',
    )
  );
}

export function insertTableAxis(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  pos: number,
  axis: 'row' | 'column',
  index: number,
): boolean {
  const table = state.doc.nodeAt(pos);
  if (table?.type.spec.tableRole !== 'table') return false;
  const map = TableMap.get(table);
  if (index < 0 || index > (axis === 'row' ? map.height : map.width)) return false;
  // Inserting at the top of a headed table adds a body row below the pinned header.
  if (axis === 'row' && index === 0 && hasHeaderRow(table)) index = 1;
  if (dispatch) {
    const rect = {
      table,
      map,
      tableStart: pos + 1,
      top: 0,
      left: 0,
      bottom: map.height,
      right: map.width,
    };
    const tr =
      axis === 'row' ? insertRowAt(state.tr, rect, index) : insertColumnAt(state.tr, rect, index);
    const nextMap = TableMap.get(tr.doc.nodeAt(pos)!);
    const source = tableNodeAt(state.selection.$from);
    if (axis === 'row') {
      const sourceRow =
        source?.pos === pos
          ? (source.row?.index ?? Math.max(0, index - 1))
          : Math.max(0, index - 1);
      for (const relative of new Set(
        nextMap.map.slice(index * nextMap.width, (index + 1) * nextMap.width),
      )) {
        const cellRect = nextMap.findCell(relative);
        if (cellRect.top !== index) continue;
        const original = table.nodeAt(
          map.map[Math.min(sourceRow, map.height - 1) * map.width + cellRect.left],
        );
        const created = tr.doc.nodeAt(pos + 1 + relative)!;
        tr.setNodeMarkup(pos + 1 + relative, undefined, {
          ...created.attrs,
          align: original?.attrs.align ?? null,
          colwidth: original?.attrs.colwidth ?? null,
        });
      }
    }
    const cell = nextMap.map[axis === 'row' ? index * nextMap.width : index];
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2 + cell))).scrollIntoView();
    dispatch(tr);
  }
  return true;
}

export function moveTableAxis(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  axis: 'row' | 'column',
  direction: -1 | 1,
): boolean {
  const hit = tableNodeAt(state.selection.$from);
  if (!hit?.cell || !hit.row) return false;
  const from = axis === 'row' ? hit.row.index : hit.cell.column;
  const boundary = direction === 1 ? from + 2 : from - 1;
  return moveTableAxisTo(state, dispatch, hit.pos, axis, from, boundary);
}
/** Stable natural ordering; keep the header and every row's identities/content intact. */
export function sortTableColumn(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  descending: boolean,
): boolean {
  const hit = tableNodeAt(state.selection.$from);
  if (!hit?.cell) return false;
  const map = TableMap.get(hit.table);
  let spans = false;
  hit.table.forEach((row) =>
    row.forEach((cell) => {
      if (cell.attrs.rowspan > 1) spans = true;
    }),
  );
  if (spans) return false;
  const rows: ProseMirrorNode[] = [];
  hit.table.forEach((row) => rows.push(row));
  const texts = new Map<ProseMirrorNode, string>();
  hit.table.forEach((row, _offset, index) =>
    texts.set(row, hit.table.nodeAt(map.map[index * map.width + hit.cell!.column])!.textContent),
  );
  const header = hasHeaderRow(hit.table) ? rows.shift() : undefined;
  const collator = new Intl.Collator(getLocale(), { numeric: true, sensitivity: 'base' });
  rows.sort((a, b) => collator.compare(texts.get(a)!, texts.get(b)!) * (descending ? -1 : 1));
  if (header) rows.unshift(header);
  if (dispatch) {
    const tr = state.tr.replaceWith(
      hit.pos,
      hit.pos + hit.table.nodeSize,
      hit.table.copy(Fragment.fromArray(rows)),
    );
    tr.setSelection(TextSelection.near(tr.doc.resolve(hit.pos + 3)));
    dispatch(tr);
  }
  return true;
}

export const insertRowAbove: Command = ({ state, dispatch }) => addRow(state, dispatch, 'above');
export const insertRowBelow: Command = ({ state, dispatch }) => addRow(state, dispatch, 'below');
export const insertColumnLeft: Command = ({ state, dispatch }) =>
  addColumn(state, dispatch, 'left');
export const insertColumnRight: Command = ({ state, dispatch }) =>
  addColumn(state, dispatch, 'right');
export const toggleTableHeaderRow: Command = ({ state, dispatch }) =>
  toggleHeaderRow(state, dispatch);
export const removeTableRow: Command = ({ state, dispatch }) => deleteRow(state, dispatch);
export const removeTableColumn: Command = ({ state, dispatch }) => deleteColumn(state, dispatch);
export const removeTable: Command = ({ state, dispatch }) => deleteTable(state, dispatch);
