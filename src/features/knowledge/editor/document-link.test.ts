import { expect, test } from 'bun:test';
import { currentDocumentLinkTarget, documentLink, readDocumentLink } from './document-link';

test('a document link identifies its knowledge workspace and strips unrelated shell state', () => {
  const link = new URL(documentLink('https://book.test/?view=settings&section=about&tab=unrelated', {
    knowledgeBaseId: 'base-a', pageId: 'page-a', source: 'server',
  }));
  expect(Object.fromEntries(link.searchParams)).toEqual({ view: 'knowledge', document: 'page-a', knowledgeBase: 'base-a', source: 'server' });
  expect(readDocumentLink(link.href)).toEqual({ knowledgeBaseId: 'base-a', pageId: 'page-a', source: 'server' });
});

test('source is part of the knowledge workspace identity and incomplete links are rejected', () => {
  expect(readDocumentLink('https://book.test/?document=page-a&knowledgeBase=base-a&source=local')).toEqual({ knowledgeBaseId: 'base-a', pageId: 'page-a', source: 'local' });
  expect(readDocumentLink('https://book.test/?document=page-a&knowledgeBase=base-a&source=unknown')).toBeNull();
  expect(readDocumentLink('https://book.test/?document=page-a&source=local')).toBeNull();
  expect(currentDocumentLinkTarget('base-a', 'local')).toBeNull();
});
