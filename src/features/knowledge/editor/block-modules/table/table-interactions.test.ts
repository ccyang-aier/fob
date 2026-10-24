import { describe, expect, test } from 'bun:test';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { CellSelection, TableMap, mergeCells, splitCell } from '@tiptap/pm/tables';
import { addRow, deleteColumn, deleteRow, insertTableAxis, moveTableAxis, selectTableAxis, sortTableColumn, toggleAxisHeader, type TableCommand } from './table-commands';
import { pinTableHeaders } from './table-header';
import { setTableAlignment, setTableColor } from './table-style';

function state(values = [['标题', '数量', '备注'], ['乙', '10', 'b'], ['甲', '2', 'a']]) {
  const table = schema.nodes.table.create({ blockId: 'table' }, values.map((texts, r) =>
    schema.nodes.tableRow.create({ blockId: 'row' + r }, texts.map((text, c) =>
      (r === 0 ? schema.nodes.tableHeader : schema.nodes.tableCell).create({ blockId: r + ':' + c },
        schema.nodes.paragraph.create({ blockId: 'p' + r + c }, text ? schema.text(text) : undefined))))));
  const doc = schema.nodes.doc.create(null, [table, schema.nodes.paragraph.create()]);
  return EditorState.create({ doc, selection: TextSelection.create(doc, 4) });
}
function apply(s: EditorState, command: TableCommand) {
  let tr: Transaction | undefined;
  expect(command(s, value => { tr = value; })).toBe(true);
  return s.apply(tr!);
}
function axis(s: EditorState, target: 'row' | 'column' | 'table', index: number, end = index) {
  return s.apply(selectTableAxis(s, 0, target, index, end)!);
}
const table = (s: EditorState) => s.doc.firstChild!;
const map = (s: EditorState) => TableMap.get(table(s));

describe('table axis interactions', () => {
  test('row, column, whole table, and reversed range selections select the intended rectangle', () => {
    const s = state();
    expect((axis(s, 'row', 1).selection as CellSelection).isRowSelection()).toBe(true);
    expect((axis(s, 'column', 1).selection as CellSelection).isColSelection()).toBe(true);
    expect((axis(s, 'table', 0).selection as CellSelection).isColSelection()).toBe(true);
    const range = axis(s, 'column', 2, 0).selection as CellSelection;
    expect(range.isColSelection()).toBe(true);
    const positions: number[] = [];
    range.forEachCell((_node, pos) => positions.push(pos));
    expect(positions).toHaveLength(9);
  });
  test('vertical column merge permits rows fully covered by rowspans, and splits without losing text', () => {
    let s = axis(state(), 'column', 0);
    s = apply(s, mergeCells);
    expect(map(s).problems).toBeNull();
    expect(table(s).child(0).child(0).attrs.rowspan).toBe(3);
    expect(table(s).textContent).toContain('乙');
    s = apply(s, splitCell);
    expect(map(s).width).toBe(3);
    expect(map(s).problems).toBeNull();
    expect(table(s).child(1).childCount).toBe(3);
  });
  test('whole table merge has valid empty covered rows, then split restores every slot', () => {
    let s = apply(axis(state(), 'table', 0), mergeCells);
    expect(table(s).child(1).childCount).toBe(0);
    table(s).check();
    expect(map(s).problems).toBeNull();
    s = apply(s, splitCell);
    expect(map(s).problems).toBeNull();
    expect(table(s).child(2).childCount).toBe(3);
  });
  test('insertion inside vertical and horizontal spans keeps the logical grid valid', () => {
    let s = apply(axis(state(), 'column', 0), mergeCells);
    s = apply(s, (s, d) => insertTableAxis(s, d, 0, 'row', 1));
    expect(map(s).height).toBe(4);
    expect(table(s).child(0).child(0).attrs.rowspan).toBe(4);
    expect(map(s).problems).toBeNull();
    s = apply(axis(state(), 'row', 1), mergeCells);
    s = apply(s, (s, d) => insertTableAxis(s, d, 0, 'column', 1));
    expect(table(s).child(1).child(0).attrs.colspan).toBe(4);
    expect(map(s).problems).toBeNull();
  });
  test('delete a row through a vertical span and delete a column through a horizontal span', () => {
    let s = apply(axis(state(), 'column', 0), mergeCells);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1 + map(s).map[map(s).width + 1] + 2)));
    s = apply(s, deleteRow);
    expect(map(s).height).toBe(2);
    expect(map(s).problems).toBeNull();
    s = apply(axis(state(), 'row', 1), mergeCells);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1 + map(s).map[1] + 2)));
    s = apply(s, deleteColumn);
    expect(map(s).width).toBe(2);
    expect(map(s).problems).toBeNull();
  });
  test('move rows/columns retains each cell identity and moves content with it', () => {
    let s = axis(state(), 'row', 1);
    s = apply(s, (s, d) => moveTableAxis(s, d, 'row', 1));
    expect(table(s).child(2).attrs.blockId).toBe('row1');
    expect(table(s).child(2).textContent).toBe('乙10b');
    s = apply(axis(s, 'column', 0), (s, d) => moveTableAxis(s, d, 'column', 1));
    expect(table(s).child(2).child(1).attrs.blockId).toBe('1:0');
    expect(table(s).child(2).child(1).textContent).toBe('乙');
    expect(map(s).problems).toBeNull();
  });
  test('numeric ascending and descending sorting preserves header, row styles, and identities', () => {
    let s = axis(state(), 'column', 1);
    s = apply(s, (s, d) => sortTableColumn(s, d, false));
    expect(table(s).child(0).textContent).toBe('标题数量备注');
    expect(table(s).child(1).attrs.blockId).toBe('row2');
    s = apply(axis(s, 'column', 1), (s, d) => sortTableColumn(s, d, true));
    expect(table(s).child(1).attrs.blockId).toBe('row1');
    expect(table(s).child(1).textContent).toBe('乙10b');
  });
  test('sort disables a table with vertical spans and boundary moves are unavailable', () => {
    const s = apply(axis(state(), 'column', 0), mergeCells);
    expect(sortTableColumn(s, undefined, false)).toBe(false);
    expect(moveTableAxis(axis(state(), 'row', 0), undefined, 'row', -1)).toBe(false);
    expect(moveTableAxis(axis(state(), 'column', 2), undefined, 'column', 1)).toBe(false);
  });
  test('header toggle changes the selected row/column only, and whole-axis deletion removes table', () => {
    let s = apply(axis(state(), 'column', 1), (s, d) => toggleAxisHeader(s, d, 'column'));
    expect(table(s).child(1).child(1).type.name).toBe('tableHeader');
    expect(table(s).child(1).child(0).type.name).toBe('tableCell');
    s = apply(axis(s, 'row', 0, 2), deleteRow);
    expect(s.doc.firstChild!.type.name).toBe('paragraph');
  });
  test('multi-column style changes cover the selected range including rowspan cells', () => {
    let s = axis(state(), 'column', 0, 1);
    s = apply(s, (s, d) => setTableColor(s, d, 'column', '#FFDF87'));
    s = apply(s, (s, d) => setTableAlignment(s, d, 'column', 'right'));
    table(s).forEach(row => {
      expect(row.child(0).attrs.background).toBe('#FFDF87');
      expect(row.child(1).attrs.align).toBe('right');
      expect(row.child(2).attrs.background).toBeNull();
    });
    s = apply(axis(s, 'column', 0), mergeCells);
    s = apply(axis(s, 'column', 1), (s, d) => setTableColor(s, d, 'column', '#88D1FF'));
    expect(table(s).child(2).child(0).attrs.background).toBe('#88D1FF');
  });
  test('row background overrides previous cell colors and spans without mutating other rows', () => {
    let s = axis(state(), 'column', 0);
    s = apply(s, (s, d) => setTableColor(s, d, 'column', '#FFDF87'));
    s = apply(axis(s, 'row', 1, 2), (s, d) => setTableColor(s, d, 'row', '#D9C6F7'));
    expect(table(s).child(1).attrs.background).toBe('#D9C6F7');
    expect(table(s).child(2).attrs.background).toBe('#D9C6F7');
    expect(table(s).child(1).child(0).attrs.background).toBeNull();
    expect(table(s).child(0).child(0).attrs.background).toBe('#FFDF87');
  });
  test('new row retains alignment while assigning no source block identities', () => {
    let s = apply(axis(state(), 'row', 1), (s, d) => setTableAlignment(s, d, 'row', 'center'));
    s = apply(s, (s, d) => addRow(s, d, 'below'));
    expect(table(s).child(2).child(1).attrs.align).toBe('center');
    expect(table(s).child(2).child(1).attrs.blockId).toBeNull();
  });
  test('insert before first row keeps a single first header while preserving old content and IDs', () => {
    const s = apply(state(), (s, d) => insertTableAxis(s, d, 0, 'row', 0));
    expect(table(s).child(0).child(0).type.name).toBe('tableHeader');
    expect(table(s).child(1).child(0).type.name).toBe('tableCell');
    expect(table(s).child(0).attrs.blockId).toBe('row0');
    expect(table(s).child(0).textContent).toBe('标题数量备注');
    expect(table(s).child(1).textContent).toBe('');
    expect(moveTableAxis(axis(s, 'row', 0), undefined, 'row', 1)).toBe(false);
    expect(moveTableAxis(axis(s, 'row', 1), undefined, 'row', -1)).toBe(false);
  });
  test('a displaced header moves back to first row with its content and identities intact', () => {
    let s = state();
    const current = table(s);
    const tr = s.tr;
    current.child(0).forEach((cell, offset) => tr.setNodeMarkup(2 + offset, schema.nodes.tableCell, cell.attrs));
    current.child(2).forEach((cell, offset) => tr.setNodeMarkup(2 + current.child(0).nodeSize + current.child(1).nodeSize + offset, schema.nodes.tableHeader, cell.attrs));
    s = s.apply(tr);
    s = s.apply(pinTableHeaders(s.tr));
    expect(table(s).child(0).child(1).type.name).toBe('tableHeader');
    expect(table(s).child(2).child(1).type.name).toBe('tableCell');
    expect(table(s).child(0).textContent).toBe(current.child(2).textContent);
    expect(table(s).child(0).attrs.blockId).toBe('row2');
    expect(table(s).child(1).textContent).toBe(current.child(0).textContent);
    expect(table(s).child(2).textContent).toBe(current.child(1).textContent);
  });
});
