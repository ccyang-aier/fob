/**
 * Pure ProseMirror tests of the E05 table commands (no DOM, no editor):
 * documents are built against the shared registry schema and commands run as
 * raw (state, dispatch) calls. Asserted per case: the boolean return, row and
 * cell counts, content and attr preservation in untouched cells, the
 * no-preset-blockId contract (new cells leave blockId null — E02 mints real
 * ids; verified end-to-end in blocks.instance.test.ts), and the last
 * row/column deletion taking the whole table with it.
 */

import { describe, expect, test } from 'bun:test';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { addColumn, addRow, deleteColumn, deleteRow, deleteTable, tableNodeAt, toggleHeaderRow } from './table-commands';

const schema = knowledgeSchema;

function cell(text: string, options: { header?: boolean; attrs?: Record<string, unknown> } = {}): ProseMirrorNode {
  const type = options.header ? schema.nodes.tableHeader : schema.nodes.tableCell;
  const paragraph = schema.nodes.paragraph.createAndFill(null, text ? schema.text(text) : undefined)!;
  return type.createAndFill(options.attrs ?? {}, paragraph)!;
}

function row(...cells: ProseMirrorNode[]): ProseMirrorNode {
  return schema.nodes.tableRow.createAndFill(null, cells)!;
}

function tableOf(...rows: ProseMirrorNode[]): ProseMirrorNode {
  return schema.nodes.table.createAndFill(null, rows)!;
}

function paragraph(text: string): ProseMirrorNode {
  return schema.nodes.paragraph.createAndFill(null, schema.text(text))!;
}

/** Header row + data row, 2x2. */
function defaultTable(): ProseMirrorNode {
  return tableOf(row(cell('H1', { header: true }), cell('H2', { header: true })), row(cell('A1'), cell('A2')));
}

function docOf(...blocks: ProseMirrorNode[]): ProseMirrorNode {
  return schema.nodes.doc.createAndFill(null, blocks)!;
}

/** State with the caret inside the first text node starting with `text`. */
function stateWithCaret(doc: ProseMirrorNode, text: string): EditorState {
  let target = -1;
  doc.descendants((node, pos) => {
    if (target < 0 && node.isText && node.text?.startsWith(text)) {
      target = pos;
      return false;
    }
    return true;
  });
  expect(target).toBeGreaterThan(-1);
  return EditorState.create({ doc, selection: TextSelection.create(doc, target + 1) });
}

/** Run one command against the state, capture its transaction, return the next state. */
function apply(state: EditorState, run: (dispatch: (tr: Transaction) => void) => boolean): EditorState {
  let applied: Transaction | null = null;
  expect(run((tr) => { applied = tr; })).toBe(true);
  return state.apply(applied!);
}

function findTable(doc: ProseMirrorNode): ProseMirrorNode | null {
  let found: ProseMirrorNode | null = null;
  doc.descendants((node) => {
    if (!found && node.type.name === 'table') found = node;
    return !found;
  });
  return found;
}

function cellTexts(rowNode: ProseMirrorNode): string[] {
  const texts: string[] = [];
  rowNode.forEach((cellNode) => texts.push(cellNode.textContent));
  return texts;
}

function cellTypes(rowNode: ProseMirrorNode): string[] {
  const types: string[] = [];
  rowNode.forEach((cellNode) => types.push(cellNode.type.name));
  return types;
}

describe('tableNodeAt', () => {
  test('resolves the table, the row and the colspan-aware cell around the caret', () => {
    const doc = docOf(paragraph('before'), defaultTable(), paragraph('after'));
    const hit = tableNodeAt(stateWithCaret(doc, 'A2').selection.$from)!;
    expect(hit).not.toBeNull();
    // Root children start at position 0, so the table follows the paragraph.
    expect(hit.pos).toBe(doc.child(0).nodeSize);
    expect(hit.table.childCount).toBe(2);
    expect(hit.row?.index).toBe(1);
    expect(hit.row?.pos).toBe(hit.pos + 1 + hit.table.child(0).nodeSize);
    expect(hit.cell?.index).toBe(1);
    expect(hit.cell?.column).toBe(1);
  });

  test('counts a colspan cell as its columns', () => {
    const wide = tableOf(row(cell('X', { attrs: { colspan: 2 } }), cell('Y')), row(cell('a'), cell('b'), cell('c')));
    const doc = docOf(paragraph('p'), wide);
    const hit = tableNodeAt(stateWithCaret(doc, 'Y').selection.$from)!;
    expect(hit.cell?.column).toBe(2);
    expect(hit.cell?.index).toBe(1);
  });

  test('returns null outside any table', () => {
    const doc = docOf(paragraph('plain'), defaultTable());
    expect(tableNodeAt(stateWithCaret(doc, 'plain').selection.$from)).toBeNull();
    expect(tableNodeAt(EditorState.create({ doc: docOf(paragraph('only')) }).selection.$from)).toBeNull();
  });
});

describe('addRow', () => {
  test('below: clones the current row layout with empty aligned cells and no preset blockId', () => {
    const source = tableOf(
      row(cell('H1', { header: true }), cell('H2', { header: true })),
      row(cell('A1', { attrs: { align: 'center' } }), cell('A2')),
    );
    const state = stateWithCaret(docOf(source), 'A1');
    const next = apply(state, (dispatch) => addRow(state, dispatch, 'below'));
    const table = findTable(next.doc)!;
    expect(table.childCount).toBe(3);
    expect(cellTexts(table.child(0))).toEqual(['H1', 'H2']);
    expect(cellTexts(table.child(1))).toEqual(['A1', 'A2']);
    expect(cellTexts(table.child(2))).toEqual(['', '']);
    // align is copied from the current row; blockId stays unset (E02 mints).
    expect(table.child(2).child(0).attrs.align).toBe('center');
    expect(table.child(2).child(0).attrs.blockId).toBeNull();
    expect(table.child(2).child(0).child(0).type.name).toBe('paragraph');
    expect(table.child(2).child(0).attrs.colspan).toBe(1);
    // The caret lands inside the new row.
    expect((next.selection as TextSelection).$cursor?.parent.textContent).toBe('');
  });

  test('above: inserts before the current row and keeps its cell kinds', () => {
    const state = stateWithCaret(docOf(defaultTable()), 'A1');
    const next = apply(state, (dispatch) => addRow(state, dispatch, 'above'));
    const table = findTable(next.doc)!;
    expect(table.childCount).toBe(3);
    expect(cellTexts(table.child(0))).toEqual(['H1', 'H2']);
    expect(cellTexts(table.child(1))).toEqual(['', '']);
    // Cloned from the plain data row, not the header row.
    expect(cellTypes(table.child(1))).toEqual(['tableCell', 'tableCell']);
    expect(cellTexts(table.child(2))).toEqual(['A1', 'A2']);
  });

  test('splits a colspan cell into colspan single cells to keep the column count', () => {
    const source = tableOf(row(cell('X', { attrs: { colspan: 2 } })));
    const state = stateWithCaret(docOf(source), 'X');
    const next = apply(state, (dispatch) => addRow(state, dispatch));
    const table = findTable(next.doc)!;
    expect(table.childCount).toBe(2);
    expect(table.child(1).childCount).toBe(2);
    table.child(1).forEach((created) => expect(created.attrs.colspan).toBe(1));
  });

  test('returns false outside a table', () => {
    const outside = stateWithCaret(docOf(paragraph('plain')), 'plain');
    expect(addRow(outside, undefined, 'below')).toBe(false);
    expect(addRow(outside)).toBe(false);
  });
});

describe('addColumn', () => {
  test('right: adds one cell to every row — header type in the header row, plain elsewhere', () => {
    const state = stateWithCaret(docOf(defaultTable()), 'A2');
    const next = apply(state, (dispatch) => addColumn(state, dispatch, 'right'));
    const table = findTable(next.doc)!;
    expect(table.childCount).toBe(2);
    expect(cellTexts(table.child(0))).toEqual(['H1', 'H2', '']);
    expect(cellTypes(table.child(0))).toEqual(['tableHeader', 'tableHeader', 'tableHeader']);
    expect(cellTexts(table.child(1))).toEqual(['A1', 'A2', '']);
    expect(cellTypes(table.child(1))).toEqual(['tableCell', 'tableCell', 'tableCell']);
    const created = table.child(1).child(2);
    expect(created.attrs.blockId).toBeNull();
    expect(created.attrs.align).toBeNull();
    expect(created.child(0).type.name).toBe('paragraph');
  });

  test('left: inserts before the current cell; untouched cells keep their align', () => {
    const source = tableOf(
      row(cell('H1', { header: true, attrs: { align: 'center' } }), cell('H2', { header: true })),
      row(cell('A1'), cell('A2', { attrs: { align: 'right' } })),
    );
    const state = stateWithCaret(docOf(source), 'A1');
    const next = apply(state, (dispatch) => addColumn(state, dispatch, 'left'));
    const table = findTable(next.doc)!;
    expect(cellTexts(table.child(0))).toEqual(['', 'H1', 'H2']);
    expect(cellTexts(table.child(1))).toEqual(['', 'A1', 'A2']);
    expect(table.child(0).child(1).attrs.align).toBe('center');
    expect(table.child(1).child(2).attrs.align).toBe('right');
  });

  test('a column born inside a spanning cell grows the span instead of splitting it', () => {
    const source = tableOf(row(cell('X', { attrs: { colspan: 2 } }), cell('Y')), row(cell('a'), cell('b'), cell('c')));
    const state = stateWithCaret(docOf(source), 'a');
    const next = apply(state, (dispatch) => addColumn(state, dispatch, 'right'));
    const table = findTable(next.doc)!;
    expect(table.child(0).child(0).attrs.colspan).toBe(3);
    expect(cellTexts(table.child(0))).toEqual(['X', 'Y']);
    expect(cellTexts(table.child(1))).toEqual(['a', '', 'b', 'c']);
  });

  test('returns false outside a table (caret in a paragraph)', () => {
    expect(addColumn(stateWithCaret(docOf(paragraph('plain')), 'plain'), undefined, 'right')).toBe(false);
  });
});

describe('toggleHeaderRow', () => {
  test('converts header → cells and back, preserving content and attrs', () => {
    const source = tableOf(
      row(cell('H1', { header: true, attrs: { align: 'center' } }), cell('H2', { header: true })),
      row(cell('A1'), cell('A2')),
    );
    const state = stateWithCaret(docOf(source), 'A1');
    const off = apply(state, (dispatch) => toggleHeaderRow(state, dispatch));
    const offTable = findTable(off.doc)!;
    expect(cellTypes(offTable.child(0))).toEqual(['tableCell', 'tableCell']);
    expect(cellTexts(offTable.child(0))).toEqual(['H1', 'H2']);
    expect(offTable.child(0).child(0).attrs.align).toBe('center');
    const on = apply(off, (dispatch) => toggleHeaderRow(off, dispatch));
    const onTable = findTable(on.doc)!;
    expect(cellTypes(onTable.child(0))).toEqual(['tableHeader', 'tableHeader']);
    expect(cellTexts(onTable.child(0))).toEqual(['H1', 'H2']);
    expect(onTable.child(0).child(0).attrs.align).toBe('center');
  });

  test('returns false outside a table', () => {
    expect(toggleHeaderRow(stateWithCaret(docOf(paragraph('plain')), 'plain'))).toBe(false);
  });
});

describe('deleteRow', () => {
  test('removes the current row and keeps the others intact', () => {
    const state = stateWithCaret(docOf(defaultTable()), 'A1');
    const next = apply(state, (dispatch) => deleteRow(state, dispatch));
    const table = findTable(next.doc)!;
    expect(table.childCount).toBe(1);
    expect(cellTexts(table.child(0))).toEqual(['H1', 'H2']);
    expect(cellTypes(table.child(0))).toEqual(['tableHeader', 'tableHeader']);
  });

  test('deleting the last row removes the whole table (schema forbids tableRow-less tables)', () => {
    const source = tableOf(row(cell('only')));
    const state = stateWithCaret(docOf(paragraph('before'), source, paragraph('after')), 'only');
    const next = apply(state, (dispatch) => deleteRow(state, dispatch));
    expect(findTable(next.doc)).toBeNull();
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).textContent).toBe('before');
  });

  test('returns false outside a table', () => {
    expect(deleteRow(stateWithCaret(docOf(paragraph('plain')), 'plain'))).toBe(false);
  });
});

describe('deleteColumn', () => {
  test('removes the current column from every row, keeping other cells and their attrs', () => {
    const source = tableOf(
      row(cell('H1', { header: true }), cell('H2', { header: true, attrs: { align: 'center' } })),
      row(cell('A1'), cell('A2')),
    );
    const state = stateWithCaret(docOf(source), 'A1');
    const next = apply(state, (dispatch) => deleteColumn(state, dispatch));
    const table = findTable(next.doc)!;
    expect(cellTexts(table.child(0))).toEqual(['H2']);
    expect(cellTexts(table.child(1))).toEqual(['A2']);
    expect(table.child(0).child(0).attrs.align).toBe('center');
    expect(cellTypes(table.child(0))).toEqual(['tableHeader']);
  });

  test('deleting the last column removes the whole table', () => {
    const source = tableOf(row(cell('only')), row(cell('more')));
    const state = stateWithCaret(docOf(paragraph('before'), source), 'more');
    const next = apply(state, (dispatch) => deleteColumn(state, dispatch));
    expect(findTable(next.doc)).toBeNull();
  });

  test('a column covered by a span shrinks the span instead of deleting the cell', () => {
    const source = tableOf(row(cell('X', { attrs: { colspan: 2 } })), row(cell('a'), cell('b')));
    const state = stateWithCaret(docOf(source), 'a');
    const next = apply(state, (dispatch) => deleteColumn(state, dispatch));
    const table = findTable(next.doc)!;
    expect(table.child(0).childCount).toBe(1);
    expect(table.child(0).child(0).attrs.colspan).toBe(1);
    expect(table.child(0).child(0).textContent).toBe('X');
    expect(cellTexts(table.child(1))).toEqual(['b']);
  });

  test('returns false outside a table', () => {
    expect(deleteColumn(stateWithCaret(docOf(paragraph('plain')), 'plain'))).toBe(false);
  });
});

describe('deleteTable', () => {
  test('removes the table, leaving surrounding blocks and a valid selection', () => {
    const doc = docOf(paragraph('before'), defaultTable(), paragraph('after'));
    const state = stateWithCaret(doc, 'A1');
    const next = apply(state, (dispatch) => deleteTable(state, dispatch));
    expect(findTable(next.doc)).toBeNull();
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.textContent).toBe('beforeafter');
    expect((next.selection as TextSelection).$cursor?.parent.textContent).toBe('after');
  });

  test('a table as the only block leaves a valid empty document', () => {
    const state = stateWithCaret(docOf(defaultTable()), 'A1');
    const next = apply(state, (dispatch) => deleteTable(state, dispatch));
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).type.name).toBe('paragraph');
  });

  test('returns false outside a table', () => {
    expect(deleteTable(stateWithCaret(docOf(paragraph('plain')), 'plain'))).toBe(false);
  });
});
