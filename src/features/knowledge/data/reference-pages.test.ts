import { expect, test } from 'bun:test';
import type { Page } from '@fob/shared/knowledge/contracts';
import { fetchReferencePages } from './reference-pages';
import { KnowledgeDataError } from './errors';

const page = (knowledgeBaseId: string, id: string, kind: Page['kind'] = 'doc', deletedAt: string | null = null) => ({ knowledgeBaseId, id, title: id, kind, deletedAt } as Page);

test('references enumerate all accessible knowledge bases while retaining each target resource', async () => {
  const queried: string[] = [];
  const result = await fetchReferencePages(undefined, {
    listKnowledgeBases: async ({ cursor } = {}) => cursor
      ? { items: [{ id: 'base-b', name: 'B' }], nextCursor: null }
      : { items: [{ id: 'base-a', name: 'A' }], nextCursor: 'next' },
    listPages: async knowledgeBaseId => {
      queried.push(knowledgeBaseId);
      return [page(knowledgeBaseId, 'readable'), page(knowledgeBaseId, 'row', 'row'), page(knowledgeBaseId, 'trash', 'doc', '2026-10-07')];
    },
  });
  expect(queried).toEqual(['base-a', 'base-b']);
  expect(result).toEqual([
    { knowledgeBaseId: 'base-a', knowledgeBaseName: 'A', id: 'readable', title: 'readable' },
    { knowledgeBaseId: 'base-b', knowledgeBaseName: 'B', id: 'readable', title: 'readable' },
  ]);
  expect(queried).not.toContain('unlisted-private-base');
});

test('a revoked knowledge base is removed from the reference choices without hiding other resources', async () => {
  const result = await fetchReferencePages(undefined, {
    listKnowledgeBases: async () => ({ items: [{ id: 'accessible', name: 'A' }, { id: 'revoked', name: 'B' }], nextCursor: null }),
    listPages: async knowledgeBaseId => {
      if (knowledgeBaseId === 'revoked') throw new KnowledgeDataError('FORBIDDEN');
      return [page(knowledgeBaseId, 'visible')];
    },
  });
  expect(result.map(item => item.knowledgeBaseId)).toEqual(['accessible']);
});

test('a network failure stays an error rather than pretending the reference directory is empty', async () => {
  const result = await Promise.allSettled([fetchReferencePages(undefined, {
    listKnowledgeBases: async () => ({ items: [{ id: 'available', name: 'A' }], nextCursor: null }),
    listPages: async () => { throw new KnowledgeDataError('NETWORK'); },
  })]);
  expect(result[0].status).toBe('rejected');
});
