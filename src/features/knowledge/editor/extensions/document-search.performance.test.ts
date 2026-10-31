import { expect, spyOn, test } from 'bun:test';
import { Node, Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import { createDocumentSearchPlugin, documentSearchKey } from './document-search';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
const document = () => schema.node('doc', null, Array.from({ length: 1000 }, (_, index) => schema.node('paragraph', null, schema.text(`needle result ${index}`))));

test('large-document result and cursor navigation reuse matches and cached highlights', () => {
  const plugin = createDocumentSearchPlugin();
  let state = EditorState.create({ doc: document(), plugins: [plugin] });
  const scan = spyOn(Node.prototype, 'descendants');
  try {
    state = state.apply(state.tr.setMeta(documentSearchKey, { query: 'needle' }));
    const initial = documentSearchKey.getState(state)!;
    expect(initial.matches).toHaveLength(1000);
    for (let current = 1; current <= 200; current++) {
      state = state.apply(state.tr.setMeta(documentSearchKey, { current }));
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, current % 2 + 1)));
      const search = documentSearchKey.getState(state)!;
      expect(search.matches === initial.matches).toBe(true);
      expect(plugin.props.decorations?.call(plugin, state) === search.decorations).toBe(true);
    }
    const final = documentSearchKey.getState(state)!;
    expect(final.current).toBe(200);
    expect(final.active?.from).toBe(final.matches[200].from);
    expect(final.decorations.find()).toHaveLength(1001);
    expect(scan.mock.calls.length).toBe(1);
    const unchanged = state.apply(state.tr.setMeta(documentSearchKey, { query: 'needle', current: 200, matchCase: false }));
    expect(documentSearchKey.getState(unchanged) === final).toBe(true);
  } finally { scan.mockRestore(); }
});

test('content, case and query changes invalidate results while a closed search does no text scans', () => {
  let state = EditorState.create({ doc: document(), plugins: [createDocumentSearchPlugin()] });
  state = state.apply(state.tr.setMeta(documentSearchKey, { query: 'NEEDLE' }));
  expect(documentSearchKey.getState(state)!.matches).toHaveLength(1000);
  state = state.apply(state.tr.setMeta(documentSearchKey, { matchCase: true }));
  expect(documentSearchKey.getState(state)!.matches).toHaveLength(0);
  state = state.apply(state.tr.setMeta(documentSearchKey, { query: 'needle', current: 999 }));
  state = state.apply(state.tr.insertText('needle ', 1));
  const updated = documentSearchKey.getState(state)!;
  expect(updated.matches).toHaveLength(1001);
  expect(state.doc.textBetween(updated.active!.from, updated.active!.to)).toBe('needle');
  state = state.apply(state.tr.setMeta(documentSearchKey, { query: '' }));
  expect(documentSearchKey.getState(state)!.decorations).toBe(DecorationSet.empty);
  const scan = spyOn(Node.prototype, 'descendants');
  try {
    for (let edit = 0; edit < 20; edit++) state = state.apply(state.tr.insertText('x', 1));
    expect(scan.mock.calls.length).toBe(0);
    expect(documentSearchKey.getState(state)!.matches).toHaveLength(0);
  } finally { scan.mockRestore(); }
});
