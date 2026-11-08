import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { KnowledgeRequestContext } from '../../access';
import type { CitationVerdict, AssistantTurn } from '@fob/shared/knowledge/contracts';
import { createAgentSourceLedger } from './sources';
import { assistantHistoryMessages } from './prompts';
import { utf8Bytes } from './budget';

const actor = { knowledgeBaseId: randomUUID(), userId: randomUUID() } as KnowledgeRequestContext;
const pool = {} as Pool;
const validate = async (_pool: Pool, input: { citedBlockIds: readonly { pageId: string; blockId: string }[] }): Promise<CitationVerdict[]> => input.citedBlockIds.map(item => ({ ...item, status: 'valid', pageTitle: '真实来源', excerpt: '权威正文' }));

test('source numbers are stable, deduplicated and backed by citation verdicts', async () => {
  const ledger = createAgentSourceLedger(pool, actor, validate), pageId = randomUUID();
  const first = await ledger.block({ pageId, blockId: 'a', markdown: '正文' }, 5_000);
  const again = await ledger.block({ pageId, blockId: 'a', markdown: '正文' }, 5_000);
  const second = await ledger.block({ pageId, blockId: 'b', markdown: '正文' }, 5_000);
  expect(first?.sourceId).toBe(1); expect(again?.sourceId).toBe(1); expect(second?.sourceId).toBe(2);
  expect(ledger.sources).toHaveLength(2); expect(ledger.contextPageIds).toEqual([pageId]);
  const invalid = createAgentSourceLedger(pool, actor, async () => []);
  expect(await invalid.block({ pageId, blockId: 'gone' }, 5_000)).toBeNull(); expect(invalid.contextPageIds).toEqual([]);
});

test('metadata is bounded before disclosures are tracked; the 101st page never enters context', () => {
  const ledger = createAgentSourceLedger(pool, actor, validate), discardedId = randomUUID();
  expect(ledger.metadata({ title: 'too large' }, [discardedId], 1)).toBeNull();
  expect(ledger.contextPageIds).toEqual([]);
  const ids = Array.from({ length: 101 }, () => randomUUID());
  for (const pageId of ids.slice(0, 100)) expect(ledger.metadata({ pageId, title: '页面' }, [pageId], 500)).not.toBeNull();
  expect(ledger.metadata({ pageId: ids[100] }, [ids[100]!], 500)).toBeNull();
  expect(ledger.contextPageIds).toEqual(ids.slice(0, 100)); expect(ledger.truncated).toBe(true);
});

test('large property values stay valid JSON and disclose truncation', () => {
  const ledger = createAgentSourceLedger(pool, actor, validate), pageId = randomUUID();
  const value = ledger.metadata({ pageId, properties: { notes: '😀'.repeat(10_000) } }, [pageId], 5_000);
  expect(value).not.toBeNull(); expect(utf8Bytes(value)).toBeLessThan(5_000); expect(ledger.truncated).toBe(true);
  expect(JSON.stringify(value)).not.toContain('�');
});

test('document history cannot import prior knowledge-base answers or another document', () => {
  const pageId = randomUUID(), other = randomUUID();
  const turn = (id: string, mode: 'document' | 'knowledgeBase', answer: string) => ({ pageId: id, mode, status: 'done', question: 'Q', answer } as AssistantTurn);
  const messages = assistantHistoryMessages([turn(pageId, 'document', '允许 [1](fob-source:1)'), turn(pageId, 'knowledgeBase', '跨页秘密'), turn(other, 'document', '其他文档')], 'document', pageId);
  expect(messages).toHaveLength(2); expect(JSON.stringify(messages)).not.toContain('跨页秘密'); expect(JSON.stringify(messages)).not.toContain('fob-source:');
  expect(assistantHistoryMessages([turn(pageId, 'document', '正文')], 'document', pageId, () => false)).toEqual([]);
});
