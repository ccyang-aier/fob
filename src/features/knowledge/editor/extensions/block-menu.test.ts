import { expect, test } from 'bun:test';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { convertMenuBlock, deleteMenuBlock, insertBelowMenuBlock, resolveMenuBlock } from './block-menu';
import type { MenuBlockFormat } from './block-menu';

const p = (id: string, text = id) => schema.nodes.paragraph.create({ blockId: id }, schema.text(text));
const state = (...nodes: ReturnType<typeof p>[]) => EditorState.create({ doc: schema.nodes.doc.create(null, nodes), plugins: [history()] });
const target = { pos: 0, blockId: 'body' };

test('choosing the current type restores a writing caret without replacing the selected block', () => {
  let current = state(p('body'));
  current = current.apply(current.tr.setSelection(NodeSelection.create(current.doc, 0)));
  const next = current.apply(convertMenuBlock(current, target, { kind: 'paragraph' })!);
  expect(next.doc.toJSON()).toEqual(current.doc.toJSON());
  expect(next.selection instanceof TextSelection).toBe(true);
  expect(next.selection.empty).toBe(true);
});

test('each text conversion preserves content, stable identity and one undo/redo unit', () => {
  for (const format of [{ kind: 'paragraph' }, { kind: 'heading', level: 1 }, { kind: 'heading', level: 2 }, { kind: 'heading', level: 3 }, { kind: 'heading', level: 4 }, { kind: 'codeBlock' }, { kind: 'blockquote' }, { kind: 'callout' }, { kind: 'bulletList' }, { kind: 'orderedList' }, { kind: 'taskList' }] satisfies MenuBlockFormat[]) {
    let current = state(p('body', '正文'), p('next', '下一个块'));
    const before = current.doc.toJSON();
    const tr = convertMenuBlock(current, target, format)!;
    expect(tr).not.toBeNull();
    current = current.apply(tr); current.doc.check();
    expect(current.doc.textContent).toBe('正文下一个块');
    expect(resolveMenuBlock(current, target)).not.toBeNull();
    expect(current.doc.lastChild?.attrs.blockId).toBe('next');
    if (format.kind === 'paragraph') continue;
    const after = current.doc.toJSON();
    expect(undo(current, transaction => { current = current.apply(transaction); })).toBe(true);
    expect(current.doc.toJSON()).toEqual(before);
    expect(redo(current, transaction => { current = current.apply(transaction); })).toBe(true);
    expect(current.doc.toJSON()).toEqual(after);
  }
});

test('converting a numbered list row preserves neighboring rows, nested content and numbering', () => {
  const row = (id: string) => schema.nodes.listItem.create({ blockId: id }, p(`${id}-text`, id));
  const list = schema.nodes.orderedList.create({ blockId: 'list', start: 5 }, [row('before'), row('body'), row('after')]);
  const current = state(list);
  const at = 1 + row('before').nodeSize;
  for (const format of [{ kind: 'heading', level: 2 }, { kind: 'taskList' }, { kind: 'blockquote' }, { kind: 'callout' }] satisfies MenuBlockFormat[]) {
    const next = current.apply(convertMenuBlock(current, { ...target, pos: at }, format)!);
    next.doc.check();
    expect(next.doc.childCount).toBe(3);
    expect(next.doc.firstChild?.attrs.start).toBe(5);
    expect(next.doc.lastChild?.attrs.start).toBe(7);
    expect(next.doc.firstChild?.firstChild?.toJSON()).toEqual(row('before').toJSON());
    expect(next.doc.lastChild?.firstChild?.toJSON()).toEqual(row('after').toJSON());
    expect(next.doc.textContent).toBe('beforebodyafter');
    const ids: string[] = [];
    next.doc.descendants(node => { if (node.attrs.blockId) ids.push(node.attrs.blockId); });
    expect(new Set(ids).size).toBe(ids.length);
  }
  const nested = schema.nodes.bulletList.create(null, row('nested'));
  const single = schema.nodes.bulletList.create(null, schema.nodes.listItem.create({ blockId: 'body' }, [p('inner', '正文'), nested]));
  const next = state(single).apply(convertMenuBlock(state(single), { ...target, pos: 1 }, { kind: 'paragraph' })!);
  expect(next.doc.textContent).toBe('正文nested'); next.doc.check();
});

test('non-text blocks and inline atoms are never silently discarded by conversion', () => {
  const image = schema.nodes.image.create({ blockId: 'body', src: 'https://example.test/a.png' });
  expect(convertMenuBlock(state(image), target, { kind: 'paragraph' })).toBeNull();
  const math = schema.nodes.paragraph.create({ blockId: 'body' }, [schema.text('公式 '), schema.nodes.inlineMath.create({ latex: 'x' })]);
  expect(convertMenuBlock(state(math), target, { kind: 'codeBlock' })).toBeNull();
  expect(state(math).apply(convertMenuBlock(state(math), target, { kind: 'heading', level: 2 })!).doc.firstChild?.lastChild?.type.name).toBe('inlineMath');
});

test('insert below chooses an empty writing row after the clicked block or list item', () => {
  const current = state(p('body'), p('next'));
  const next = current.apply(insertBelowMenuBlock(current, target)!);
  expect(next.doc.childCount).toBe(3); expect(next.selection.$from.parent.type.name).toBe('paragraph');
  expect(next.selection.$from.parent.content.size).toBe(0);
  const list = schema.nodes.taskList.create(null, schema.nodes.taskItem.create({ blockId: 'body', checked: true }, p('text')));
  const listed = state(list), inserted = listed.apply(insertBelowMenuBlock(listed, { ...target, pos: 1 })!);
  expect(inserted.doc.firstChild?.childCount).toBe(2);
  expect(inserted.doc.firstChild?.lastChild?.attrs.checked).toBe(false);
  expect(inserted.selection.$from.parent.type.name).toBe('paragraph'); inserted.doc.check();
});

test('deleting the final block or final list row leaves a valid editable document', () => {
  for (const current of [state(p('body')), state(schema.nodes.bulletList.create(null, schema.nodes.listItem.create({ blockId: 'body' }, p('text'))))]) {
    const next = current.apply(deleteMenuBlock(current, target)!);
    next.doc.check(); expect(next.doc.firstChild?.type.name).toBe('paragraph'); expect(next.doc.textContent).toBe('');
  }
});

test('stale positions follow block identity and deleted targets cannot affect their neighbor', () => {
  const current = state(p('prefix'), p('body'));
  expect(resolveMenuBlock(current, target)).toBe(p('prefix').nodeSize);
  const deleted = state(p('different'));
  expect(resolveMenuBlock(deleted, { pos: 1000, blockId: 'body' })).toBeNull();
  expect(deleteMenuBlock(deleted, target)).toBeNull();
  expect(insertBelowMenuBlock(deleted, target)).toBeNull();
});
