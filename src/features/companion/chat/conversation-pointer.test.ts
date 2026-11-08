import { expect, test } from 'bun:test';
import { clearConversationPointer, companionPointerStorageKey, readConversationPointer, saveConversationPointer } from './conversation-pointer';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

test('bounds recent pointers and persists only valid opaque user/library/conversation IDs', () => {
  const saved = storage();
  for (let index = 1; index <= 14; index++) saveConversationPointer(saved, { userId: id(1), knowledgeBaseId: id(index + 100), conversationId: id(index + 200) });
  const parsed = JSON.parse(saved.getItem(companionPointerStorageKey)!);
  expect(parsed.pointers).toHaveLength(10);
  expect(readConversationPointer(saved, id(1), id(101))).toBeNull();
  expect(readConversationPointer(saved, id(1), id(114))).toBe(id(214));
  expect(readConversationPointer(saved, id(2), id(114))).toBeNull();
  expect(Object.keys(parsed.pointers[0]).sort()).toEqual(['conversationId', 'knowledgeBaseId', 'userId']);
  saveConversationPointer(saved, { userId: id(1), knowledgeBaseId: id(114), conversationId: id(999) });
  expect(JSON.parse(saved.getItem(companionPointerStorageKey)!).pointers).toHaveLength(10);
  expect(readConversationPointer(saved, id(1), id(114))).toBe(id(999));
});

test('ignores malformed storage and discards unexpected content when writing', () => {
  const saved = storage();
  for (const value of ['{', 'null', '[]', '{"version":2,"pointers":[]}', '{"version":1,"pointers":[{"userId":"private question"}]}']) {
    saved.setItem(companionPointerStorageKey, value); expect(readConversationPointer(saved, id(1), id(2))).toBeNull();
  }
  saved.setItem(companionPointerStorageKey, JSON.stringify({ version: 1, pointers: [{ userId: id(1), knowledgeBaseId: id(2), conversationId: id(3), question: 'private text', credential: 'never persist this' }] }));
  saveConversationPointer(saved, { userId: id(1), knowledgeBaseId: id(4), conversationId: id(5) });
  expect(saved.getItem(companionPointerStorageKey)).not.toContain('private text');
  expect(saved.getItem(companionPointerStorageKey)).not.toContain('credential');
});

test('a stale conversation deletion cannot clear a newer scope pointer and denied storage is optional', () => {
  const saved = storage();
  saveConversationPointer(saved, { userId: id(1), knowledgeBaseId: id(2), conversationId: id(4) });
  clearConversationPointer(saved, id(1), id(2), id(3));
  expect(readConversationPointer(saved, id(1), id(2))).toBe(id(4));
  clearConversationPointer(saved, id(1), id(2), id(4));
  expect(saved.getItem(companionPointerStorageKey)).toBeNull();
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  expect(readConversationPointer(denied, id(1), id(2))).toBeNull();
  expect(() => saveConversationPointer(denied, { userId: id(1), knowledgeBaseId: id(2), conversationId: id(3) })).not.toThrow();
  expect(() => clearConversationPointer(denied, id(1), id(2))).not.toThrow();
});
