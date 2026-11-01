import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { addWorkbenchTab, createWorkbenchTabs, openWorkbenchTab, reloadWorkbenchTab, splitWorkbenchTab, tabTarget, type WorkbenchTabsState } from './workbench-tabs';

let browser: Window;
let root: Root;
let host: HTMLDivElement;
let renderPanels: (state: WorkbenchTabsState) => ReactNode;
let scope = 'principal:local:base-a';
const mounts = new Map<string, number>();

function ExamplePage({ name }: { name: string }) {
  const [draft, setDraft] = useState('');
  useEffect(() => { mounts.set(name, (mounts.get(name) ?? 0) + 1); }, [name]);
  return <input aria-label={name + ' draft'} value={draft} onInput={event => setDraft(event.currentTarget.value)} />;
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3100/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'ResizeObserver']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/features/knowledge/data/knowledge-base-resources', () => ({ useKnowledgeBaseResources: () => ({ scopeKey: scope,selectedKnowledgeBase: { id: 'base-a',source: 'local' } }) }));
  mock.module('@/features/knowledge/knowledge-page', () => ({ KnowledgePage: () => <ExamplePage name="knowledge" /> }));
  mock.module('@/features/knowledge/organization/knowledge-members-page', () => ({ KnowledgeMembersPage: () => <ExamplePage name="members" /> }));
  mock.module('@/features/knowledge/templates/templates-page', () => ({ TemplatesPage: () => <ExamplePage name="templates" /> }));
  mock.module('@/features/identity/profile/personal-profile-page', () => ({ PersonalProfilePage: ({ onOpenResource }: { onOpenResource: (resource: { id: string; kind: 'document' | 'folder' }) => void }) => <><button onClick={() => onOpenResource({ id: 'from-profile',kind: 'document' })}>Open profile document</button><button onClick={() => onOpenResource({ id: 'folder-from-profile',kind: 'folder' })}>Open profile folder</button></> }));
  const { WorkbenchPanels } = await import('./workbench-panels');
  renderPanels = state => <WorkbenchPanels tabs={state.tabs} active={state.active} split={state.split} navigationOwner={state.tabs.findLast(tab => tab.view === 'knowledge')?.key} onReportDocument={() => {}} onTogglePin={() => {}} onSplitDocument={() => {}} onResizeSplit={() => {}} />;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
beforeEach(async () => {
  await act(async () => root.render(null));
  scope = 'principal:local:base-a';
  mounts.clear();
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

test('switching between knowledge and members keeps the live editor draft mounted', async () => {
  let state = createWorkbenchTabs(scope, tabTarget('knowledge'));
  await act(async () => root.render(renderPanels(state)));
  const input = host.querySelector('input')!;
  await act(async () => { input.value = 'Research draft'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  state = openWorkbenchTab(state, tabTarget('members'));
  await act(async () => root.render(renderPanels(state)));
  expect(host.querySelector('#workbench-panel-0')?.hasAttribute('hidden')).toBe(true);
  state = openWorkbenchTab(state, tabTarget('knowledge'));
  await act(async () => root.render(renderPanels(state)));
  expect(host.querySelector('input')).toBe(input);
  expect(input.value).toBe('Research draft');
  expect(mounts.get('knowledge')).toBe(1);
});

test('duplicate tabs are independent, reordering preserves hosts, and reload remounts one editor', async () => {
  let state = createWorkbenchTabs(scope, tabTarget('knowledge'));
  state = addWorkbenchTab(state, tabTarget('knowledge'));
  await act(async () => root.render(renderPanels(state)));
  const original = host.querySelector('#workbench-panel-0');
  const duplicate = host.querySelector('#workbench-panel-1');
  await act(async () => root.render(renderPanels({ ...state, tabs: [...state.tabs].reverse() })));
  expect(host.querySelector('#workbench-panel-0')).toBe(original);
  expect(host.querySelector('#workbench-panel-1')).toBe(duplicate);
  state = reloadWorkbenchTab(state, 'tab:1');
  await act(async () => root.render(renderPanels(state)));
  expect(host.querySelector('#workbench-panel-0')).toBe(original);
  expect(host.querySelector('#workbench-panel-1')).not.toBe(duplicate);
  expect(mounts.get('knowledge')).toBe(3);
});

test('split panes preserve both editor hosts and do not add a second tab strip', async () => {
  let state = createWorkbenchTabs(scope, tabTarget('knowledge', '?document=one&knowledgeBase=base-a&source=local'));
  await act(async () => root.render(renderPanels(state)));
  const original = host.querySelector('input')!;
  state = splitWorkbenchTab(state, state.active, { title: 'One', target: { pageId: 'one', knowledgeBaseId: 'base-a', source: 'local' } });
  await act(async () => root.render(renderPanels(state)));
  expect(host.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(2);
  expect(host.querySelector('input')).toBe(original);
  expect(host.querySelectorAll('[role="tablist"]')).toHaveLength(0);
  expect(host.querySelectorAll('[role="separator"]')).toHaveLength(1);
  expect(mounts.get('knowledge')).toBe(2);
  await act(async () => root.render(renderPanels({ ...state, split: undefined })));
  expect(host.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
  expect(host.querySelector('input')).toBe(original);
});

test('profile targets preserve the current knowledge owner and delegate folder mode to its adapter', async () => {
  const { subscribeOpenFolderTarget } = await import('@/features/knowledge/navigation/open-folder-target');
  const { subscribeOpenPageTarget } = await import('@/features/knowledge/editor/open-target');
  const received: string[] = [];
  const closeFolder = subscribeOpenFolderTarget(target => received.push(target.folderId));
  const closePage = subscribeOpenPageTarget(target => received.push(target.pageId));
  try {
    let state = addWorkbenchTab(createWorkbenchTabs(scope,tabTarget('knowledge')),tabTarget('knowledge'));
    state = openWorkbenchTab(state,tabTarget('profile'));
    await act(async () => root.render(renderPanels(state)));
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    const document = new URL(browser.location.href);
    expect(document.searchParams.get('document')).toBe('from-profile');
    expect(document.searchParams.get('knowledgeBase')).toBe('base-a');
    expect(document.searchParams.get('tab')).toBe('tab:1');
    await act(async () => (host.querySelectorAll('button')[1] as HTMLButtonElement).click());
    expect(new URL(browser.location.href).searchParams.get('folder')).toBe('folder-from-profile');
    expect(received).toEqual(['from-profile','folder-from-profile']);
  } finally { closeFolder(); closePage(); }
});
