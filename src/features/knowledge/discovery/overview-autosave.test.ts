import { expect, test } from 'bun:test';
import { createOverviewAutosave } from './overview-autosave';
const body = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

test('autosave serializes revisions and retains the latest edit made during a request', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writes: { text: string; revision: number }[] = [];
  const queue = createOverviewAutosave({ content: body('initial'), revision: 4 }, async (content, revision) => { writes.push({ text: content.content![0].content![0].text!, revision }); if (writes.length === 1) await gate; return revision + 1; }, () => {});
  queue.update(body('first')); const saving = queue.flush();
  queue.update(body('latest'));
  expect(queue.receive(body('old remote value'), 4)).toBe(false);
  release(); await saving;
  expect(writes).toEqual([{ text: 'first', revision: 4 }, { text: 'latest', revision: 5 }]);
  expect(queue.draft()).toEqual({ content: body('latest'), revision: 6 });
});

test('failed saves retain the draft and revision for an explicit retry', async () => {
  const states: string[] = []; let fail = true;
  const queue = createOverviewAutosave({ content: body('initial'), revision: 2 }, async (_content, revision) => { if (fail) throw new Error('Conflict'); return revision + 1; }, state => states.push(state));
  queue.update(body('unsaved')); await queue.flush();
  expect(states.at(-1)).toBe('error'); expect(queue.draft()).toEqual({ content: body('unsaved'), revision: 2 });
  expect(queue.receive(body('remote'), 3)).toBe(false);
  fail = false; await queue.flush(); expect(queue.draft().revision).toBe(3); expect(states.at(-1)).toBe('saved');
});

test('clean editors accept remote changes and restored drafts flush when leaving', async () => {
  const writes: number[] = [];
  const queue = createOverviewAutosave({ content: body('restored'), revision: 7 }, async (_content, revision) => { writes.push(revision); return revision + 1; }, () => {});
  queue.restore(); await queue.flush(); expect(writes).toEqual([7]);
  expect(queue.receive(body('remote'), 9)).toBe(true); expect(queue.draft().content).toEqual(body('remote'));
  expect(queue.receive(body('stale'), 8)).toBe(false);
});
