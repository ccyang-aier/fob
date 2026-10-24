import { expect, test } from 'bun:test';
import type { Page } from '@fob/shared/knowledge/contracts';
import type { LocalLibrary } from '../local/local-library';
import type { HybridSearchOutcome } from './search-api';
import { searchLocalKnowledge, searchServerKnowledge, type KnowledgeSearchServices } from './knowledge-search';

const page = (id: string, title: string, deletedAt: string | null = null) => ({ id, title, deletedAt }) as Page;
const content = (pageId: string, text = 'matching body'): HybridSearchOutcome => ({
  vectorLeg: null, rerank: null,
  hits: [{ pageId, blockId: 'b:match', blockType: 'paragraph', titlePath: null, snippet: text,
    sources: ['keyword'], keywordScore: 1, semanticScore: null, rrfScore: 1, rerankScore: null }],
});

test('local search reads titles/body only inside the selected knowledge base, excluding recycled content', () => {
  const document = (id: string, baseId: string, title: string, text: string, deleted = false) => ({
    id, baseId, title, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    deleted, draft: false, starred: false, updatedAt: '2026-10-25T00:00:00Z',
  });
  const library: LocalLibrary = {
    bases: [{ id: 'current', name: 'Current' }, { id: 'other', name: 'Another workspace' }],
    folders: [], tags: [], documents: [
      document('body', 'current', 'Research', 'A searchable finding'),
      document('title', 'current', 'searchable', 'Another body'),
      document('other', 'other', 'searchable', 'Must not leak'),
      document('deleted', 'current', 'searchable', 'Must not leak', true),
    ],
  };
  const scope = library.bases[0];
  expect(searchLocalKnowledge(library, scope, 'SEARCHABLE').hits.map(hit => hit.pageId)).toEqual(['title', 'body']);
  expect(searchLocalKnowledge(library, scope, 'finding').hits[0].snippet).toContain('finding');
  expect(searchLocalKnowledge(library, { id: 'missing', name: 'Missing' }, 'searchable').hits).toEqual([]);
  expect(searchLocalKnowledge(library, scope, 's').hits).toEqual([]);
});

test('server search queries only selected KB and merges allowed title/content results', async () => {
  const requested: string[] = [];
  const result = await searchServerKnowledge({ knowledgeBaseId: 'selected', query: 'match', signal: new AbortController().signal }, {
    async listPages(id) { requested.push(id); return [page('title', 'Title match'), page('body', 'Body document'), page('deleted', 'match', '2026-10-25')]; },
    async search(id) { requested.push(id); return { ...content('body'), hits: [...content('body').hits, ...content('deleted').hits, ...content('denied').hits] }; },
  });
  expect(requested).toEqual(['selected', 'selected']);
  expect(result.hits.map(hit => hit.pageId)).toEqual(['title', 'body']);
  expect(result.hits[1]).toMatchObject({ knowledgeBaseId: 'selected', title: 'Body document', blockId: 'b:match', source: 'server' });
  expect(result.incomplete).toBe(false);
});

test('revocation in either server leg invalidates earlier allowed title results', async () => {
  await expect(searchServerKnowledge({ knowledgeBaseId: 'selected', query: 'match', signal: new AbortController().signal }, {
    async listPages() { return [page('earlier', 'match')]; },
    async search() { throw { data: { code: 'FORBIDDEN', httpStatus: 403 } }; },
  })).rejects.toThrow('SEARCH_UNAVAILABLE');
});

test('cancelled knowledge-base scope cannot return a late response from a transport ignoring abort', async () => {
  const controller = new AbortController();
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const result = searchServerKnowledge({ knowledgeBaseId: 'old-base', query: 'match', signal: controller.signal }, {
    async listPages() { await delayed; return [page('late', 'match')]; },
    async search() { await delayed; return content('late'); },
  });
  controller.abort(); release();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});

test('partial retrieval is explicit and total failure never masquerades as no matching documents', async () => {
  const input = { knowledgeBaseId: 'selected', query: 'match', signal: new AbortController().signal };
  const services: KnowledgeSearchServices = {
    async listPages() { return [page('title', 'match')]; }, async search() { throw new Error('NETWORK'); },
  };
  expect((await searchServerKnowledge(input, services)).incomplete).toBe(true);
  services.listPages = async () => { throw new Error('NETWORK'); };
  await expect(searchServerKnowledge(input, services)).rejects.toThrow('SEARCH_UNAVAILABLE');
});
