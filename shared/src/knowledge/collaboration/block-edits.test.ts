import { expect, test } from 'bun:test';
import { blockContentSnapshot, blockEditFingerprint, readBlockEdit, updateBlockEdits } from './block-edits';

const body = (text: string, id = 'a') => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] }] });
const first = { actorId: 'local', actorName: null, editedAt: '2026-11-07T07:00:00.000Z', fingerprint: blockEditFingerprint(blockContentSnapshot(body('B')).get('a')!) };
const second = { actorId: 'other', actorName: '另一位编辑者', editedAt: '2026-11-07T08:00:00.000Z', fingerprint: blockEditFingerprint(blockContentSnapshot(body('C', 'b')).get('b')!) };

test('only changed blocks gain provenance; unchanged and deleted records stay accurate', () => {
  expect(updateBlockEdits(body('A'), body('B'), {}, first)).toEqual({ a: first });
  expect(updateBlockEdits(body('B'), body('B'), { a: first }, second)).toEqual({ a: first });
  expect(updateBlockEdits(body('B'), body('C', 'b'), { a: first }, second)).toEqual({ b: second });
  expect(updateBlockEdits(body('A'), body('A'), {}, first)).toEqual({});
});

test('unavailable or malformed metadata is never displayed as a made-up author or date', () => {
  expect(readBlockEdit(first)).toEqual(first);
  for (const value of [undefined, null, {}, { ...first, editedAt: 'invalid' }, { ...first, actorName: 1 }, { ...first, actorId: null }]) expect(readBlockEdit(value)).toBeNull();
});
