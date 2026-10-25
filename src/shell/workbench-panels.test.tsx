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
  mock.module('@/features/knowledge/data/knowledge-base-resources', () => ({ useKnowledgeBaseResources: () => ({ scopeKey: scope }) }));
  mock.module('@/features/knowledge/knowledge-page', () => ({ KnowledgePage: () => <ExamplePage name="knowledge" /> }));
  mock.module('@/features/knowledge/organization/knowledge-members-page', () => ({ KnowledgeMembersPage: () => <ExamplePage name="members" /> }));
  mock.module('@/features/knowledge/templates/templates-page', () => ({ TemplatesPage: () => <ExamplePage name="templates" /> }));
  mock.module('@/features/rewards', () => ({ RewardsPage: () => <ExamplePage name="rewards" /> }));
  const { WorkbenchPanels } = await import('./workbench-panels');
  renderPanels = state => <WorkbenchPanels tabs={state.tabs} active={state.active} split={state.split} onReportDocument={() => {}} onTogglePin={() => {}} onSplitDocument={() => {}} onResizeSplit={() => {}} />;
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
