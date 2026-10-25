import { expect, test } from 'bun:test';
import { createLocalTemplatesStore, localDocumentFromTemplate, localTemplateSnapshot } from './local-templates';
import { newLocalDocument } from '../local/local-library';

test('template snapshots and each new page own independent content and block identities', () => {
  const source = newLocalDocument('base-a', 'Research');
  source.body = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'original' }, content: [{ type: 'text', text: 'Keep this finding' }] }] };
  const snapshot = localTemplateSnapshot(source, 'Research brief', 'One useful starting point');
  source.body.content![0].content![0].text = 'Changed source';
  const first = localDocumentFromTemplate(snapshot, 'base-a', 'First', 'folder-a');
  const second = localDocumentFromTemplate(snapshot, 'base-a', 'Second');
  expect(first.body.content![0].content![0].text).toBe('Keep this finding');
  expect(first.id).not.toBe(second.id);
  expect(first.body.content![0].attrs!.blockId).not.toBe('original');
  expect(first.body.content![0].attrs!.blockId).not.toBe(second.body.content![0].attrs!.blockId);
  first.body.content![0].content![0].text = 'Only first';
  expect(second.body.content![0].content![0].text).toBe('Keep this finding');
  expect(first.folderId).toBe('folder-a');
  expect(() => localDocumentFromTemplate(snapshot, 'base-b', 'Leak')).toThrow('another knowledge base');
});

test('quota failures never publish an unsaved template catalog', () => {
  const store = createLocalTemplatesStore({ getItem: () => null, setItem: () => { throw new Error('Quota'); } });
  let updates = 0; store.subscribe(() => updates++);
  const snapshot = localTemplateSnapshot(newLocalDocument('base-a', 'Research'), 'Template', '');
  expect(() => store.update(items => [...items, snapshot])).toThrow('Quota');
  expect(store.getSnapshot()).toEqual([]); expect(updates).toBe(0);
});

test('deleted and binary source documents cannot be presented as text templates', () => {
  const source = newLocalDocument('base-a', 'Research'); source.deleted = true;
  expect(() => localTemplateSnapshot(source, 'Deleted', '')).toThrow('live text document');
});
