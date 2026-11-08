import { expect, test } from 'bun:test';
import { createCompanionContextStore, emptyCompanionContext, type CompanionWorkspaceContext } from './companion-context-store';

const workspace = (userId = 'alice', knowledgeBaseId = 'library-a'): CompanionWorkspaceContext => ({ status: 'ready', userId, knowledgeBaseId, knowledgeBaseName: knowledgeBaseId });
const document = (userId = 'alice', knowledgeBaseId = 'library-a', pageId = 'page-a') => ({ userId, knowledgeBaseId, document: { pageId, title: pageId, editable: true } });

test('accepts the active document before its workspace mounts without publishing an unauthenticated page', () => {
  const store = createCompanionContextStore();
  store.document(Symbol(), document());
  expect(store.getSnapshot()).toBe(emptyCompanionContext);
  store.workspace(Symbol(), workspace());
  expect(store.getSnapshot().document?.pageId).toBe('page-a');
  expect(store.getServerSnapshot()).toBe(emptyCompanionContext);
});

test('workspace account and library changes cannot inherit another scope document', () => {
  const store = createCompanionContextStore(), owner = Symbol();
  store.document(Symbol(), document()); store.workspace(owner, workspace());
  expect(store.getSnapshot().document?.pageId).toBe('page-a');
  store.workspace(owner, workspace('bob'));
  expect(store.getSnapshot().document).toBeNull();
  store.workspace(owner, workspace('alice', 'library-b'));
  expect(store.getSnapshot().document).toBeNull();
  store.document(Symbol(), document('alice', 'library-b', 'page-b'));
  expect(store.getSnapshot().document?.pageId).toBe('page-b');
});

test('inactive/unmounted editors release only their own publication', () => {
  const store = createCompanionContextStore(); store.workspace(Symbol(), workspace());
  const releaseA = store.document(Symbol(), document());
  const releaseB = store.document(Symbol(), document('alice', 'library-a', 'page-b'));
  releaseA();
  expect(store.getSnapshot().document?.pageId).toBe('page-b');
  releaseB();
  expect(store.getSnapshot().document).toBeNull();
});

test('stale effect cleanup cannot remove a newer publication from the same owner', () => {
  const store = createCompanionContextStore(), root = Symbol(), page = Symbol();
  const oldRoot = store.workspace(root, workspace());
  store.workspace(root, workspace('alice', 'library-b'));
  oldRoot();
  expect(store.getSnapshot().knowledgeBaseId).toBe('library-b');
  const oldPage = store.document(page, document('alice', 'library-b'));
  store.document(page, document('alice', 'library-b', 'page-b'));
  oldPage();
  expect(store.getSnapshot().document?.pageId).toBe('page-b');
});

test('local, checking, failed and signed-out scopes never expose a server document', () => {
  const store = createCompanionContextStore(), root = Symbol(); store.document(Symbol(), document());
  for (const status of ['local', 'checking', 'error', 'signed-out', 'no-knowledge-base'] as const) {
    store.workspace(root, { ...workspace(), status });
    expect(store.getSnapshot().document).toBeNull();
  }
});

test('unchanged publications retain snapshot identity and unsubscription is complete', () => {
  const store = createCompanionContextStore(), root = Symbol(); let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications++; });
  store.workspace(root, workspace()); const snapshot = store.getSnapshot();
  store.workspace(root, workspace());
  expect(store.getSnapshot()).toBe(snapshot); expect(notifications).toBe(1);
  unsubscribe(); store.workspace(root, workspace('bob'));
  expect(notifications).toBe(1);
});

test('removing the workbench clears all projected identity and page metadata', () => {
  const store = createCompanionContextStore(); store.document(Symbol(), document());
  const release = store.workspace(Symbol(), workspace()); release();
  expect(store.getSnapshot()).toBe(emptyCompanionContext);
});
