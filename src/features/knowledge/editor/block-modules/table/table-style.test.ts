import { describe, expect, test } from 'bun:test';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { setTableAlignment, setTableColor, setTableVariant } from './table-style';

const paragraph = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const cell = (text: string) => schema.nodes.tableCell.create(null, paragraph(text));
const row = (...cells: ReturnType<typeof cell>[]) => schema.nodes.tableRow.create(null, cells);

function state(): EditorState {
  const table = schema.nodes.table.create(null, [row(cell('a'), cell('b')), row(cell('c'), cell('d'))]);
  const doc = schema.nodes.doc.create(null, table);
  return EditorState.create({ doc, selection: TextSelection.create(doc, 4) });
}

function apply(current: EditorState, command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean): EditorState {
  let transaction: Transaction | null = null;
  expect(command(current, (tr) => { transaction = tr; })).toBe(true);
  return current.apply(transaction!);
}

describe('table style commands', () => {
  test('colors a cell, row, column, or entire table without changing content', () => {
    let current = state();
    current = apply(current, (s, dispatch) => setTableColor(s, dispatch, 'cell', '#FCE8E5'));
    let table = current.doc.firstChild!;
    expect(table.child(0).child(0).attrs.background).toBe('#FCE8E5');
    expect(table.child(0).child(1).attrs.background).toBeNull();
    current = apply(current, (s, dispatch) => setTableColor(s, dispatch, 'row', '#E6F3EC'));
    table = current.doc.firstChild!;
    expect(table.child(0).attrs.background).toBe('#E6F3EC');
    expect(table.child(1).attrs.background).toBeNull();
    current = apply(current, (s, dispatch) => setTableColor(s, dispatch, 'column', '#E5F1F9'));
    table = current.doc.firstChild!;
    expect(table.child(0).child(0).attrs.background).toBe('#E5F1F9');
    expect(table.child(1).child(0).attrs.background).toBe('#E5F1F9');
    current = apply(current, (s, dispatch) => setTableColor(s, dispatch, 'table', '#EEEAFB'));
    table = current.doc.firstChild!;
    expect(table.attrs.background).toBe('#EEEAFB');
    expect(table.textContent).toBe('abcd');
  });

  test('alignment and visual variant retain the table structure', () => {
    let current = state();
    current = apply(current, (s, dispatch) => setTableAlignment(s, dispatch, 'table', 'center'));
    current = apply(current, (s, dispatch) => setTableVariant(s, dispatch, 'striped'));
    const table = current.doc.firstChild!;
    expect(table.attrs.variant).toBe('striped');
    table.forEach((row) => row.forEach((cell) => expect(cell.attrs.align).toBe('center')));
  });
});
