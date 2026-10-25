import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { KNOWLEDGE_NAVIGATED, updateDocumentNavigation } from './document-navigation-location';

let browser: Window;
beforeAll(() => { browser = new Window({ url: 'http://localhost:3001/?view=knowledge&project=project-a&tab=tab%3A2&document=old&knowledgeBase=old-base&source=local&comment=old-comment' }); Object.assign(globalThis, { window: browser, Event: browser.Event }); });
afterAll(async () => { await browser.happyDOM.abort(); });

test('a document selection replaces a stale deep target while preserving the knowledge workspace and independent tab', () => {
  const length = browser.history.length;
  updateDocumentNavigation({ knowledgeBaseId: 'new-base', pageId: 'new-document', source: 'local' });
  const query = new URL(browser.location.href).searchParams;
  expect(query.has('project')).toBe(false);
  expect(query.get('tab')).toBe('tab:2');
  expect(query.get('document')).toBe('new-document');
  expect(query.get('knowledgeBase')).toBe('new-base');
  expect(query.has('comment')).toBe(false);
  expect(browser.history.length).toBe(length);
});

test('returning to a list consumes the old linked document and emits the sole drawer navigation event', () => {
  let actions = 0;
  browser.addEventListener(KNOWLEDGE_NAVIGATED, () => actions++);
  updateDocumentNavigation(null);
  const query = new URL(browser.location.href).searchParams;
  expect(query.has('project')).toBe(false);
  expect(query.get('tab')).toBe('tab:2');
  expect(query.has('document')).toBe(false);
  expect(query.get('knowledgeBase')).toBe('new-base');
  expect(query.get('source')).toBe('local');
  expect(actions).toBe(1);
});

test('an external document open uses the owning knowledge tab even while templates is selected', () => {
  browser.history.replaceState({}, '', '?view=templates&tab=tab%3A8&knowledgeBase=new-base&source=local');
  updateDocumentNavigation({ knowledgeBaseId: 'new-base', pageId: 'created', source: 'local' }, '?tab=tab%3A2');
  expect(new URL(browser.location.href).searchParams.get('tab')).toBe('tab:2');
  updateDocumentNavigation({ knowledgeBaseId: 'new-base', pageId: 'primary', source: 'local' }, '');
  expect(new URL(browser.location.href).searchParams.has('tab')).toBe(false);
});
