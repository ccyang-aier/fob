import { expect, test } from 'bun:test';
import type { JSONContent } from '@tiptap/core';
import { knowledgeSchema } from '../schema';
import { materializeKnowledgeTemplateDocument } from './materialize';

test('template documents retain content but obtain independent blocks without source review or runtime bindings', () => {
  const original: JSONContent = { type: 'doc', content: [
    { type: 'paragraph', attrs: { blockId: 'source', sourceBlockId: 'old', annotations: [{ type: 'suggestion_delete', attrs: { suggestionId: 'suggestion', author: 'owner', createdAt: '2026-10-25T01:00:00Z' } }] },
      content: [{ type: 'text', text: 'Keep text', marks: [{ type: 'bold' }, { type: 'comment', attrs: { threadId: 'source-thread' } }, { type: 'suggestion_insert', attrs: { suggestionId: 'suggestion', author: 'owner', createdAt: '2026-10-25T01:00:00Z' } }] }] },
    { type: 'databaseView', attrs: { blockId: 'database', databaseId: 'source-database', view: 'table', config: { selection: 'private' } } },
    { type: 'aiBlock', attrs: { blockId: 'ai', prompt: 'Prompt', taskId: 'running', scope: { pageId: 'source' }, schedule: 'tomorrow', tier: 'fast' }, content: [{ type: 'paragraph', attrs: { blockId: 'child' } }] },
  ] };
  const serialized = JSON.stringify(original);
  let id = 0;
  const copied = materializeKnowledgeTemplateDocument(original, () => `fresh_${id++}`);
  const model = knowledgeSchema.nodeFromJSON(copied);
  model.check();
  expect(model.firstChild!.attrs).toMatchObject({ blockId: 'fresh_0', sourceBlockId: null, annotations: null });
  expect(model.firstChild!.firstChild!.marks.map((mark) => mark.type.name)).toEqual(['bold']);
  expect(model.child(1).attrs).toMatchObject({ databaseId: null, config: null });
  expect(model.child(2).attrs).toMatchObject({ taskId: null, scope: null, schedule: null, prompt: 'Prompt' });
  expect(model.textContent).toBe('Keep text');
  expect(JSON.stringify(original)).toBe(serialized);
  const again = materializeKnowledgeTemplateDocument(copied, () => `second_${id++}`);
  expect(again.content![0]!.attrs!.blockId).not.toBe(copied.content![0]!.attrs!.blockId);
});

test('malformed document nodes and nonunique generated block identities are rejected', () => {
  expect(() => materializeKnowledgeTemplateDocument({ type: 'doc', content: [{ type: 'unknown' }] })).toThrow();
  expect(() => materializeKnowledgeTemplateDocument({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] }, () => 'same')).toThrow();
});
