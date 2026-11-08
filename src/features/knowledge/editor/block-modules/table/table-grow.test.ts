import { expect, test } from 'bun:test';
import { EditorState } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { TableMap, fixTables, mergeCells } from '@tiptap/pm/tables';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { selectTableAxis, type TableCommand } from './table-commands';
import { appendTableAxes } from './table-grow';

function initial() {
  const table = schema.nodes.table.create({ blockId: 'table' }, [0, 1, 2].map(row =>
    schema.nodes.tableRow.create({ blockId: `r${row}` }, [0, 1, 2].map(column =>
      (row ? schema.nodes.tableCell : schema.nodes.tableHeader).create(
        { blockId: `${row}:${column}`, colwidth: [120] }, schema.nodes.paragraph.create(null, schema.text(`${row}:${column}`)),
      ),
    )),
  ));
  return EditorState.create({ doc: schema.nodes.doc.create(null, [table, schema.nodes.paragraph.create(null, schema.text('After'))]), plugins: [history()] });
}
function apply(state: EditorState, command: TableCommand) {
  let next = state;
  expect(command(state, tr => { next = state.apply(tr); })).toBe(true);
  return next;
}
test('append several rows in one undoable transaction without changing existing cells or adjacent blocks', () => {
  const original = initial();
  let state = apply(original, appendTableAxes(0, 'row', 4));
  expect(TableMap.get(state.doc.firstChild!).height).toBe(7);
  for (let row = 0; row < 3; row++) expect(state.doc.firstChild!.child(row).eq(original.doc.firstChild!.child(row))).toBe(true);
  expect(state.doc.lastChild!.eq(original.doc.lastChild!)).toBe(true);
  state = apply(state, undo);
  expect(state.doc.eq(original.doc)).toBe(true);
  state = apply(state, redo);
  expect(TableMap.get(state.doc.firstChild!).height).toBe(7);
});
test('append columns after a horizontal merge preserves the grid, content and heading types', () => {
  let state = initial();
  state = state.apply(selectTableAxis(state, 0, 'row', 1)!);
  state = apply(state, mergeCells);
  const fixed = fixTables(state);
  if (fixed) state = state.apply(fixed);
  const content = state.doc.textContent;
  state = apply(state, appendTableAxes(0, 'column', 3));
  const table = state.doc.firstChild!, map = TableMap.get(table);
  expect(map.width).toBe(6);
  expect(map.problems).toBeNull();
  expect(state.doc.textContent).toBe(content);
  expect(table.firstChild!.lastChild!.type.name).toBe('tableHeader');
  expect(table.child(2).lastChild!.type.name).toBe('tableCell');
  table.check();
});
test('reject invalid counts and stale table positions', () => {
  const state = initial();
  for (const count of [0, -1, 101, 1.5, NaN]) expect(appendTableAxes(0, 'row', count)(state)).toBe(false);
  for (const pos of [-1, 0.5, state.doc.content.size]) expect(appendTableAxes(pos, 'row', 1)(state)).toBe(false);
  expect(appendTableAxes(state.doc.firstChild!.nodeSize, 'column', 1)(state)).toBe(false);
});

test('works inside Tiptap commands whose state always returns the same transaction', () => {
  const state = initial(), transaction = state.tr;
  const chainable = Object.create(state) as EditorState;
  Object.defineProperty(chainable, 'tr', { get: () => transaction });
  let next = state;
  expect(appendTableAxes(0, 'row', 2)(chainable, tr => { next = state.apply(tr); })).toBe(true);
  expect(TableMap.get(next.doc.firstChild!).height).toBe(5);
});
