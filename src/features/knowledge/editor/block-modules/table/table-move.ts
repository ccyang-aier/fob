import { Fragment } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';

/** Move one complete axis to a gap, without splitting merged cells or moving the header. */
export function moveTableAxisTo(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, pos: number, axis: 'row' | 'column', from: number, boundary: number): boolean {
  const table = state.doc.nodeAt(pos);
  if (table?.type.spec.tableRole !== 'table') return false;
  const map = TableMap.get(table);
  const length = axis === 'row' ? map.height : map.width;
  const to = boundary > from ? boundary - 1 : boundary;
  if (from < 0 || from >= length || boundary < 0 || boundary > length || to === from) return false;
  const header = !!table.firstChild?.childCount && table.firstChild.children.every(cell => cell.type.spec.tableRole === 'header_cell');
  if (axis === 'row' && header && (from === 0 || boundary === 0)) return false;
  for (const cell of new Set(map.map)) {
    const rect = map.findCell(cell);
    const start = axis === 'row' ? rect.top : rect.left;
    const end = axis === 'row' ? rect.bottom : rect.right;
    if (end - start > 1 && (from >= start && from < end || boundary > start && boundary < end)) return false;
  }
  if (!dispatch) return true;
  const order = Array.from({ length }, (_, index) => index);
  order.splice(from, 1);
  order.splice(to, 0, from);
  const rows = axis === 'row' ? order.map(index => table.child(index)) : [];
  if (axis === 'column') {
    const positions = new Map(order.map((column, index) => [column, index]));
    table.forEach((row, offset) => {
      const cells: Array<{ cell: typeof row; column: number }> = [];
      row.forEach((cell, cellOffset) => cells.push({ cell, column: map.findCell(offset + 1 + cellOffset).left }));
      cells.sort((a, b) => positions.get(a.column)! - positions.get(b.column)!);
      rows.push(row.copy(Fragment.fromArray(cells.map(({ cell }) => cell))));
    });
  }
  const next = table.copy(Fragment.fromArray(rows));
  const nextMap = TableMap.get(next);
  const first = nextMap.map[axis === 'row' ? to * map.width : to];
  const last = nextMap.map[axis === 'row' ? to * map.width + map.width - 1 : (map.height - 1) * map.width + to];
  const tr = state.tr.replaceWith(pos, pos + table.nodeSize, next);
  tr.setSelection(CellSelection.create(tr.doc, pos + 1 + first, pos + 1 + last));
  dispatch(tr.scrollIntoView());
  return true;
}
