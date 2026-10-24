import { describe, expect, test } from 'bun:test';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { CellSelection, TableMap, fixTables, mergeCells } from '@tiptap/pm/tables';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { moveTableAxisTo } from './table-move';
import { selectTableAxis } from './table-commands';
import { setTableSelectionHeading, setTableSelectionLink, tableSelectionHasMark, toggleTableSelectionMark } from './table-selection-format';
import { setTableColor } from './table-style';
import { buildAddCommentSelectionTransaction, collectCommentAnchors } from '../../../comments/comment-anchors';

function initial() {
  return EditorState.create({ plugins: [history()], doc: schema.nodes.doc.create(null, schema.nodes.table.create({ blockId: 'table' }, Array.from({ length: 5 }, (_, row) => schema.nodes.tableRow.create({ blockId: `row${row}`, background: row === 1 ? '#C8D9BF' : null }, Array.from({ length: 4 }, (_, col) => (row ? schema.nodes.tableCell : schema.nodes.tableHeader).create({ blockId: `${row}:${col}`, colwidth: [110 + col * 20] }, schema.nodes.paragraph.create({ blockId: `p${row}:${col}` }, schema.text(`${row}:${col}`)))))))) });
}
function apply(state: EditorState, command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) {
  let next = state;
  expect(command(state, tr => { next = state.apply(tr); })).toBe(true);
  return next;
}
function rectangle(state: EditorState) {
  const map = TableMap.get(state.doc.firstChild!);
  return state.apply(state.tr.setSelection(CellSelection.create(state.doc, 1 + map.map[1 * 4 + 1], 1 + map.map[3 * 4 + 2])));
}

describe('table single-axis relocation', () => {
  test('arbitrary row relocation preserves identity, content, style, selection and undo/redo', () => {
    const original = initial();
    let state = apply(original, (s, d) => moveTableAxisTo(s, d, 0, 'row', 1, 5));
    expect(state.doc.firstChild!.child(4).eq(original.doc.firstChild!.child(1))).toBe(true);
    expect(state.doc.firstChild!.child(0).eq(original.doc.firstChild!.child(0))).toBe(true);
    expect((state.selection as CellSelection).isRowSelection()).toBe(true);
    expect(TableMap.get(state.doc.firstChild!).problems).toBeNull();
    state = apply(state, undo);
    expect(state.doc.eq(original.doc)).toBe(true);
    state = apply(state, redo);
    state = apply(state, (s, d) => moveTableAxisTo(s, d, 0, 'row', 4, 1));
    expect(state.doc.eq(original.doc)).toBe(true);
  });
  test('arbitrary column relocation carries content, widths and IDs in both directions', () => {
    const original = initial();
    let state = apply(original, (s, d) => moveTableAxisTo(s, d, 0, 'column', 0, 4));
    for (let row = 0; row < 5; row++) expect(state.doc.firstChild!.child(row).child(3).eq(original.doc.firstChild!.child(row).child(0))).toBe(true);
    expect((state.selection as CellSelection).isColSelection()).toBe(true);
    state = apply(state, (s, d) => moveTableAxisTo(s, d, 0, 'column', 3, 0));
    expect(state.doc.eq(original.doc)).toBe(true);
  });
  test('pinned header and unchanged drops are unavailable', () => {
    const state = initial();
    expect(moveTableAxisTo(state, undefined, 0, 'row', 0, 3)).toBe(false);
    expect(moveTableAxisTo(state, undefined, 0, 'row', 2, 0)).toBe(false);
    expect(moveTableAxisTo(state, undefined, 0, 'column', 1, 2)).toBe(false);
    expect(moveTableAxisTo(state, undefined, 0, 'column', 1, 5)).toBe(false);
  });
  test('merged cells remain intact; moves that split a span are unavailable', () => {
    let state = initial();
    const map = TableMap.get(state.doc.firstChild!);
    state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, 1 + map.map[4 + 1], 1 + map.map[4 + 2])));
    state = apply(state, mergeCells);
    const fixed = fixTables(state);
    if (fixed) state = state.apply(fixed);
    expect(moveTableAxisTo(state, undefined, 0, 'column', 1, 4)).toBe(false);
    expect(moveTableAxisTo(state, undefined, 0, 'column', 3, 2)).toBe(false);
    state = apply(state, (s, d) => moveTableAxisTo(s, d, 0, 'column', 0, 4));
    expect(TableMap.get(state.doc.firstChild!).problems).toBeNull();
    expect(state.doc.firstChild!.child(1).child(0).attrs.colspan).toBe(2);
    state = apply(state, (s, d) => moveTableAxisTo(s, d, 0, 'row', 1, 5));
    expect(state.doc.firstChild!.child(4).child(0).attrs.colspan).toBe(2);
  });
});

describe('rectangular table formatting', () => {
  test('mixed code and paragraph cells toggle only eligible text and report its active state', () => {
    let state = initial();
    const first = TableMap.get(state.doc.firstChild!).map[5];
    state = state.apply(state.tr.setNodeMarkup(first + 2, schema.nodes.codeBlock, { blockId: 'code' }));
    state = rectangle(state);
    state = apply(state, (s, d) => toggleTableSelectionMark(s, d, 'bold'));
    expect(tableSelectionHasMark(state, 'bold')).toBe(true);
    expect(state.doc.nodeAt(first + 2)!.type.name).toBe('codeBlock');
    expect(state.doc.nodeAt(first + 3)!.marks).toHaveLength(0);
    state = apply(state, (s, d) => toggleTableSelectionMark(s, d, 'bold'));
    expect(tableSelectionHasMark(state, 'bold')).toBe(false);
    state.doc.descendants(node => { if (node.isText) expect(node.marks).toHaveLength(0); });
  });
  test('marks, headings, links and background touch only the 3x2 selection', () => {
    let state = rectangle(initial());
    for (const name of ['bold', 'italic', 'strike', 'code']) {
      state = apply(state, (s, d) => toggleTableSelectionMark(s, d, name));
      expect(tableSelectionHasMark(state, name)).toBe(true);
    }
    state = apply(state, (s, d) => setTableSelectionHeading(s, d, 2));
    state = apply(state, (s, d) => setTableSelectionLink(s, d, 'https://example.com'));
    state = apply(state, (s, d) => setTableColor(s, d, 'cell', '#CEC2E2'));
    state.doc.firstChild!.forEach((row, _, r) => row.forEach((cell, _, c) => {
      const chosen = r >= 1 && r <= 3 && c >= 1 && c <= 2;
      expect(cell.firstChild!.type.name).toBe(chosen ? 'heading' : 'paragraph');
      expect(cell.attrs.background).toBe(chosen ? '#CEC2E2' : null);
      expect(cell.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(chosen ? ['bold', 'italic', 'strike', 'code', 'link'] : []);
      expect(cell.firstChild!.attrs.blockId).toBe(`p${r}:${c}`);
    }));
    expect(state.selection instanceof CellSelection).toBe(true);
    state = apply(state, (s, d) => toggleTableSelectionMark(s, d, 'bold'));
    expect(tableSelectionHasMark(state, 'bold')).toBe(false);
    state = apply(state, (s, d) => setTableSelectionHeading(s, d, 2));
    expect(state.doc.firstChild!.child(1).child(1).firstChild!.type.name).toBe('paragraph');
    expect(setTableSelectionLink(state, undefined, 'javascript:alert(1)')).toBe(false);
    state = apply(state, (s, d) => setTableSelectionLink(s, d, null));
    expect(tableSelectionHasMark(state, 'link')).toBe(false);
  });
  test('formatting never rewrites required paragraph children of list items', () => {
    let state = rectangle(initial());
    const map = TableMap.get(state.doc.firstChild!);
    const cellPos = 1 + map.map[4 + 1];
    const list = schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text('列表内容'))));
    state = state.apply(state.tr.insert(cellPos + 1 + state.doc.nodeAt(cellPos)!.content.size, list));
    state = rectangle(state);
    state = apply(state, (s, d) => setTableSelectionHeading(s, d, 1));
    state.doc.check();
    expect(state.doc.firstChild!.child(1).child(1).lastChild!.firstChild!.firstChild!.type.name).toBe('paragraph');
  });
  test('comments anchor disjoint cells instead of the continuous document interval', () => {
    const state = rectangle(initial());
    const next = state.apply(buildAddCommentSelectionTransaction(state, 'comment-selection')!);
    const anchors = collectCommentAnchors(next.doc);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].ranges).toHaveLength(6);
    next.doc.firstChild!.forEach((row, _, r) => row.forEach((cell, _, c) => expect(cell.firstChild!.firstChild!.marks.some(mark => mark.type.name === 'comment')).toBe(r >= 1 && r <= 3 && c >= 1 && c <= 2)));
    const textState = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4, 6)));
    expect(buildAddCommentSelectionTransaction(textState, 'text')).not.toBeNull();
  });
  test('rail selections remain a single logical row or column', () => {
    const state = initial();
    const row = state.apply(selectTableAxis(state, 0, 'row', 2)!);
    expect((row.selection as CellSelection).isRowSelection()).toBe(true);
    expect(TableMap.get(row.doc.firstChild!).rectBetween((row.selection as CellSelection).$anchorCell.pos - 1, (row.selection as CellSelection).$headCell.pos - 1).bottom).toBe(3);
  });
});
