import { expect, test } from 'bun:test';
import { indexedDB } from 'fake-indexeddb';
import { KnowledgeUiSession } from './knowledge-ui-session';

Object.assign(globalThis, { indexedDB });

test('fresh sessions restore typed data and stay isolated by principal, source and knowledge base', async () => {
  const scope = 'alice:local:knowledge-base-a';
  const first = new KnowledgeUiSession(scope);
  await first.loaded;
  const draft = { text: 'unfinished', at: new Date('2026-10-18T10:00:00Z'), attachments: [new Blob(['actual bytes'], { type: 'text/plain' })] };
  first.set('page:7:draft', draft, null);
  first.set('tabs', { order: [7, 2], active: 7 }, null);
  const reopened = new KnowledgeUiSession(scope);
  await reopened.loaded;
  expect(reopened.get('tabs', null)).toEqual({ order: [7, 2], active: 7 });
  const restored = reopened.get<typeof draft | null>('page:7:draft', null)!;
  expect(restored.text).toBe('unfinished');
  expect(restored.at instanceof Date).toBe(true);
  expect(await restored.attachments[0].text()).toBe('actual bytes');
  for (const other of ['bob:local:knowledge-base-a', 'alice:server:project-a', 'alice:local:knowledge-base-b']) {
    const session = new KnowledgeUiSession(other);
    await session.loaded;
    expect(session.get('tabs', null)).toBeNull();
    expect(session.get('page:7:draft', null)).toBeNull();
  }
});

test('updates queued during hydration merge into stored data and closing only removes released page state', async () => {
  const first = new KnowledgeUiSession('pending:local:knowledge-base');
  await first.loaded;
  first.set('chat.history', ['first'], []);
  first.set('page:1:draft', 'keep', '');
  first.set('page:2:draft', 'close', '');
  const restored = new KnowledgeUiSession(first.scope);
  restored.set<string[]>('chat.history', entries => [...entries, 'second'], []);
  await restored.loaded;
  expect(restored.get('chat.history', [])).toEqual(['first', 'second']);
  restored.retainPages([1]);
  const next = new KnowledgeUiSession(first.scope);
  await next.loaded;
  expect(next.get('page:1:draft', '')).toBe('keep');
  expect(next.get('page:2:draft', '')).toBe('');
  expect(next.get('chat.history', [])).toEqual(['first', 'second']);
});

test('storage failures are reported while the live UI state remains usable', async () => {
  const session = new KnowledgeUiSession('failure:local:knowledge-base');
  await session.loaded;
  const unsupported = { callback: () => {} };
  session.set('page:1:draft', unsupported, null);
  expect(session.getStatus().ready).toBe(true);
  expect(session.getStatus().error instanceof Error).toBe(true);
  expect(session.get('page:1:draft', null)).toBe(unsupported);
  session.set('page:1:query', 'still usable', '');
  expect(session.get('page:1:query', '')).toBe('still usable');
});

test('duplicating a page copies typed UI fields independently without copying shared conversation history', async () => {
  const session = new KnowledgeUiSession('copy:local:knowledge-base');
  await session.loaded;
  session.set('page:3:draft', { text: 'source', files: [new Blob(['attachment'])], at: new Date(123) }, null);
  session.set('page:3:knowledge:local:base:scroll:editor', { top: 280, left: 0 }, null);
  session.set('page:2:query', 'unrelated', '');
  session.set('chat.history', ['shared'], []);
  expect(session.copyPage(3, 4)).toBe(true);
  const original = session.get<{ text: string } | null>('page:3:draft', null)!;
  const copy = session.get<{ text: string } | null>('page:4:draft', null)!;
  expect(copy).not.toBe(original);
  copy.text = 'copy edited';
  expect(original.text).toBe('source');
  const reopened = new KnowledgeUiSession(session.scope);
  await reopened.loaded;
  const restored = reopened.get<{ text: string; files: Blob[]; at: Date } | null>('page:4:draft', null)!;
  expect(restored.text).toBe('source');
  expect(await restored.files[0].text()).toBe('attachment');
  expect(restored.at.getTime()).toBe(123);
  expect(reopened.get('page:4:knowledge:local:base:scroll:editor', null)).toEqual({ top: 280, left: 0 });
  expect(reopened.get('page:4:query', null)).toBeNull();
  expect(reopened.get('chat.history', [])).toEqual(['shared']);
});
