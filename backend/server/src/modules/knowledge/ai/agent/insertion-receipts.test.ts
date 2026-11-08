import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { withInsertionReceipt } from './insertion-receipts';

test('body and receipt round-trip together and a retry never repeats an accepted body insertion', () => {
  const original = new Y.Doc(), turnId = randomUUID(), userId = randomUUID(); let inserted = 0;
  const receipt = { turnId, userId, retainedTurnIds: [turnId] };
  const mutate = () => { inserted++; original.getText('body').insert(0, 'Answer'); return 'suggestion'; };
  const first = original.transact(() => withInsertionReceipt(original, receipt, mutate));
  const persisted = new Y.Doc(); Y.applyUpdate(persisted, Y.encodeStateAsUpdate(original));
  const again = persisted.transact(() => withInsertionReceipt(persisted, receipt, () => { inserted++; return 'duplicate'; }));
  expect(first).toBe('suggestion'); expect(again).toBe(first); expect(inserted).toBe(1); expect(persisted.getText('body').toString()).toBe('Answer');
  original.destroy(); persisted.destroy();
});

test('completed or deleted local-user turns are pruned while another user receipts remain intact', () => {
  const document = new Y.Doc(), userId = randomUUID(), other = randomUUID(), first = randomUUID(), second = randomUUID();
  document.transact(() => withInsertionReceipt(document, { turnId: first, userId, retainedTurnIds: [first] }, () => 'first'));
  document.transact(() => withInsertionReceipt(document, { turnId: first, userId: other, retainedTurnIds: [first] }, () => 'other'));
  document.transact(() => withInsertionReceipt(document, { turnId: second, userId, retainedTurnIds: [second] }, () => 'second'));
  const receipts = document.getMap('fob:assistant:insertion-receipts');
  expect(receipts.size).toBe(2); expect(receipts.has(`${userId}:${first}`)).toBe(false); expect(receipts.has(`${other}:${first}`)).toBe(true);
  document.destroy();
});

test('receipt admission fails at the hard cap instead of evicting another retriable insertion', () => {
  const document = new Y.Doc(), records = document.getMap('fob:assistant:insertion-receipts');
  for (let i = 0; i < 256; i++) records.set(`${randomUUID()}:${randomUUID()}`, 'existing');
  let inserted = false;
  expect(() => document.transact(() => withInsertionReceipt(document, { turnId: randomUUID(), userId: randomUUID(), retainedTurnIds: [] }, () => { inserted = true; return 'new'; }))).toThrow('WRITE_RECEIPT_CAPACITY');
  expect(inserted).toBe(false); expect(records.size).toBe(256); document.destroy();
});
