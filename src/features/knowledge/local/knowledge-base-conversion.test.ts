import { expect, test } from 'bun:test';
import { localKnowledgeBaseSnapshot, rebindLocalKnowledgeLinks } from './knowledge-base-conversion';
import { emptyLocalLibrary, newLocalDocument } from './local-library';

test('conversion snapshot excludes documents and assets belonging to other libraries', () => {
  const a = newLocalDocument('alpha', 'A'), b = newLocalDocument('beta', 'B');
  expect(localKnowledgeBaseSnapshot({ ...emptyLocalLibrary, documents: [a, b], tags: [{ id: 'tag-b', baseId: 'beta', name: 'B', pageIds: [b.id] }] }, 'alpha')).toEqual({ folders: [], documents: [a], tags: [] });
});
test('conversion rebinds internal absolute links and explicit block references without modifying external links', () => {
  const href = 'http://localhost:3001/?view=knowledge&document=page&knowledgeBase=alpha&source=local#anchor';
  const body = { attrs: { knowledgeBaseId: 'alpha', source: 'local', pageId: 'page' }, content: [{ marks: [{ attrs: { href } }] }, { attrs: { href: href.replace('localhost:3001', 'example.com') } }, { type: 'text', text: href }] };
  const result = rebindLocalKnowledgeLinks(body, 'alpha', 'team', 'http://localhost:3001') as typeof body;
  expect(result.attrs).toEqual({ knowledgeBaseId: 'team', source: 'server', pageId: 'page' });
  expect(result.content[0]!.marks![0]!.attrs.href).toContain('knowledgeBase=team&source=server');
  expect(result.content[1]).toEqual(body.content[1]);
  expect(result.content[2]).toEqual(body.content[2]);
  expect(body.attrs.knowledgeBaseId).toBe('alpha');
});
