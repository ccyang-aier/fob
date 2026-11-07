import { expect, test } from 'bun:test';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { createHeadingSectionsPlugin, headingSections, headingSectionsKey, toggleHeadingSection, expandHeadingSectionsAt, withExpandedHeadingSections } from './heading-sections';

const p = (id: string) => schema.nodes.paragraph.create({ blockId: id }, schema.text(id));
const h = (id: string, level = 1) => schema.nodes.heading.create({ blockId: id, level }, schema.text(id));
function fixture(...nodes: ReturnType<typeof p>[]) {
  let state = EditorState.create({ doc: schema.nodes.doc.create(null, nodes), plugins: [history(), createHeadingSectionsPlugin()] });
  const view = { get state() { return state; }, dispatch(tr) { state = state.applyTransaction(tr).state; } } as EditorView;
  return view;
}
const folded = (view: EditorView) => [...headingSectionsKey.getState(view.state)!.folded];
const hidden = (view: EditorView) => headingSectionsKey.getState(view.state)!.decorations.find().filter((decoration) => (decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs['data-heading-content-hidden']);

test('chapter boundaries respect skipped levels, siblings and the last section', () => {
  const view = fixture(h('a'), p('body'), h('b', 3), p('child'), h('c', 2), p('second'), h('d'), p('last'));
  const sections = headingSections(view.state.doc);
  const byId = Object.fromEntries(sections.map((item) => [item.id, item]));
  expect(byId.a.to).toBe(byId.d.pos);
  expect(byId.b.to).toBe(byId.c.pos);
  expect(byId.c.to).toBe(byId.d.pos);
  expect(byId.d.to).toBe(view.state.doc.content.size);
  toggleHeadingSection(view, 'b'); toggleHeadingSection(view, 'a');
  expect(folded(view)).toEqual(['b', 'a']);
  toggleHeadingSection(view, 'a');
  expect(folded(view)).toEqual(['b']);
  expect(hidden(view).map((item) => view.state.doc.nodeAt(item.from)?.textContent)).toEqual(['child']);
});

test('folding preserves document data and undo, moves hidden caret, and reveals nested targets', () => {
  const view = fixture(h('a'), h('b', 2), p('child'), h('c'), p('tail'));
  const before = view.state.doc.toJSON();
  const section = headingSections(view.state.doc).find(({ id }) => id === 'b')!;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, section.from + 1)));
  toggleHeadingSection(view, 'b'); toggleHeadingSection(view, 'a');
  expect(view.state.selection.from).toBe(headingSections(view.state.doc)[0].from - 1);
  expect(view.state.doc.toJSON()).toEqual(before);
  expect(undo(view.state, view.dispatch)).toBe(false);
  expandHeadingSectionsAt(view, section.from);
  expect(folded(view)).toEqual([]);
  toggleHeadingSection(view, 'a');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, section.from + 1)));
  expect(folded(view)).toEqual([]);
});

test('stable heading IDs survive inserts; deleting a heading removes stale fold state', () => {
  const view = fixture(h('a'), p('body'), h('b'), p('tail'));
  toggleHeadingSection(view, 'a');
  view.dispatch(view.state.tr.insert(0, p('intro')));
  expect(folded(view)).toEqual(['a']);
  const section = headingSections(view.state.doc).find(({ id }) => id === 'a')!;
  view.dispatch(view.state.tr.delete(section.pos, section.from));
  expect(folded(view)).toEqual([]);
});

test('nested containers fold only sibling content; entire rich blocks are hidden together', () => {
  const quote = schema.nodes.blockquote.create({ blockId: 'quote' }, [h('nested', 2), p('inside')]);
  const list = schema.nodes.bulletList.create({ blockId: 'list' }, schema.nodes.listItem.create({ blockId: 'row' }, p('item')));
  const view = fixture(h('a'), quote, list, h('b'), p('outside'));
  toggleHeadingSection(view, 'nested');
  expect(hidden(view).map(({ from }) => view.state.doc.nodeAt(from)?.textContent)).toEqual(['inside']);
  toggleHeadingSection(view, 'a');
  expect(hidden(view).map(({ from }) => view.state.doc.nodeAt(from)?.type.name)).toEqual(['blockquote', 'bulletList']);
});

test('selection-only transactions reuse the range cache; export restores folds even on failure', () => {
  const view = fixture(h('a'), p('body'));
  const before = headingSectionsKey.getState(view.state);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
  expect(headingSectionsKey.getState(view.state)).toBe(before);
  toggleHeadingSection(view, 'a');
  expect(withExpandedHeadingSections(view, () => hidden(view).length)).toBe(0);
  expect(folded(view)).toEqual(['a']);
  expect(() => withExpandedHeadingSections(view, () => { throw new Error('snapshot'); })).toThrow('snapshot');
  expect(folded(view)).toEqual(['a']);
  expect(view.state.doc.textContent).toBe('abody');
});
