import { expect, test } from 'bun:test';
import { assistantAskSchema, assistantTurnSchema } from './assistant';

const id = '10000000-0000-4000-8000-000000000001';

test('knowledge-base conversations may omit the current page without inventing a resource', () => {
  for (const page of [{}, { pageId: null }]) {
    const input = assistantAskSchema.parse({ requestId: id, question: '你好', mode: 'knowledgeBase', ...page });
    expect(input.pageId).toBeNull(); expect(input.mode).toBe('knowledgeBase'); expect(input.tier).toBe('fast');
  }
});

test('document mode requires a valid current page, including when mode is defaulted', () => {
  for (const mode of [{}, { mode: 'document' }]) {
    for (const page of [{}, { pageId: null }, { pageId: '' }, { pageId: 'not-a-page' }]) {
      expect(assistantAskSchema.safeParse({ requestId: id, question: '总结文档', ...mode, ...page }).success).toBe(false);
    }
  }
  expect(assistantAskSchema.parse({ requestId: id, pageId: id, question: '总结文档' }).mode).toBe('document');
  expect(assistantAskSchema.parse({ requestId: id, pageId: id, mode: 'knowledgeBase', question: '查找资料' }).pageId).toBe(id);
});

test('durable page-less turns and legacy page turns share the same transport schema', () => {
  const turn = { id, question: '你好', answer: '我在。', mode: 'knowledgeBase', pageId: null, status: 'done', sources: [], errorCode: null, createdAt: '2026-11-09T00:00:00.000Z', appliedPageId: null, model: null, inputTokens: null, outputTokens: null };
  expect(assistantTurnSchema.parse(turn).pageId).toBeNull();
  expect(assistantTurnSchema.parse({ ...turn, pageId: id, mode: 'document' }).pageId).toBe(id);
  expect(assistantAskSchema.safeParse({ requestId: id, question: '你好', mode: 'knowledgeBase', pageId: null, knowledgeBaseId: id }).success).toBe(false);
});
