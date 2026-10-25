import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { KnowledgeUiSession } from '@/lib/knowledge-ui-session';
import { KnowledgeUiSessionContext } from '@/lib/page-session-state';
import { replaceWorkbenchLocation } from '@/lib/navigation-history';
import { updateFolderNavigation } from '@/features/knowledge/navigation/document-navigation-location';
import { createWorkbenchStartup } from './workbench-tabs';
import { useWorkbenchTabs } from './use-workbench-tabs';
import { useWorkbenchView } from './workbench-view';

let browser: Window, root: Root;
let scope = 'alice:server:first', session = new KnowledgeUiSession(scope);
let current: ReturnType<typeof useWorkbenchTabs>;
const startup = createWorkbenchStartup();
function Capture() {
  const [view, , , , search] = useWorkbenchView(scope);
  const tabs = useWorkbenchTabs(scope, view, search, true, startup);
  useEffect(() => { current = tabs; }, [tabs]);
  return null;
}
const render = () => <KnowledgeUiSessionContext value={session}><Capture /></KnowledgeUiSessionContext>;
beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3001/?knowledgeBase=first&source=server' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

test('switching into a fresh knowledge base finishes restoration before accepting its first folder navigation', async () => {
  await session.loaded; await act(async () => root.render(render()));
  expect(current.scope).toBe(scope);
  scope = 'alice:local:fresh'; session = new KnowledgeUiSession(scope); await session.loaded;
  await act(async () => {
    replaceWorkbenchLocation(new URL('http://localhost:3001/?knowledgeBase=fresh&source=local'));
    root.render(render());
  });
  await act(async () => updateFolderNavigation({ knowledgeBaseId: 'fresh', source: 'local', folderId: 'folder' }, current.tabs[0].search));
  expect(new URL(browser.location.href).searchParams.get('folder')).toBe('folder');
  expect(current.tabs[0].search).toContain('folder=folder');
  await act(async () => current.reportTitle(current.active, 'Local research'));
  expect(new URL(browser.location.href).searchParams.get('folder')).toBe('folder');
  expect(current.tabs[0].title).toBe('Local research');
  expect(current.tabs[0].search).toContain('knowledgeBase=fresh');
});
