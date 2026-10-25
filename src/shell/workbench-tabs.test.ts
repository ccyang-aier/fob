import { expect, test } from 'bun:test';
import { splitWorkbenchTab, knowledgeScopedSearch, addWorkbenchTab, closeWorkbenchTab, createWorkbenchTabs, openWorkbenchTab, pinWorkbenchTab, reloadWorkbenchTab, reorderWorkbenchTabs, restoreWorkbenchTabs, tabTarget } from './workbench-tabs';

test('members entry and closing a library tab always retain one live knowledge navigation owner', () => {
  let state = createWorkbenchTabs('scope', tabTarget('members'));
  expect(state.active).toBe('members');
  expect(state.tabs.some(tab => tab.view === 'knowledge')).toBe(true);
  const knowledge = state.tabs.find(tab => tab.view === 'knowledge')!;
  state = closeWorkbenchTab(state, knowledge.key);
  expect(state.active).toBe('members');
  expect(state.tabs.filter(tab => tab.view === 'knowledge').length).toBe(1);
  expect(state.tabs.find(tab => tab.view === 'knowledge')?.instance).not.toBe(knowledge.instance);
});

test('knowledge routes retain resource links while settings remain an overlay', () => {
  const target = tabTarget('knowledge', '?view=settings&returnView=knowledge&section=general&kb=library&page=document');
  expect(target.search).toBe('?kb=library&page=document');
  let state = createWorkbenchTabs('user:local:a', target);
  state = openWorkbenchTab(state, tabTarget('members'));
  const instance = state.tabs[1].instance;
  state = openWorkbenchTab(state, target);
  state = openWorkbenchTab(state, tabTarget('members'));
  expect(state.tabs.map(tab => tab.key)).toEqual(['knowledge', 'members']);
  expect(state.tabs[1].instance).toBe(instance);
});

test('closing the last tab opens a fresh knowledge instance', () => {
  let state = createWorkbenchTabs('scope', tabTarget('knowledge'));
  state = openWorkbenchTab(state, tabTarget('members'));
  state = closeWorkbenchTab(state, 'members');
  expect(state.active).toBe('knowledge');
  const original = state.tabs[0].instance;
  state = closeWorkbenchTab(state, 'knowledge');
  expect(state.tabs).toHaveLength(1);
  expect(state.tabs[0].view).toBe('knowledge');
  expect(state.tabs[0].instance).not.toBe(original);
});

test('duplicate knowledge tabs keep separate instances and explicit targets', () => {
  let state = createWorkbenchTabs('scope', tabTarget('knowledge', '?kb=a&page=one'));
  state = addWorkbenchTab(state, tabTarget('knowledge', '?kb=a&page=two'));
  expect(state.tabs.map(tab => tab.instance)).toEqual([0, 1]);
  expect(state.active).toBe('tab:1');
  const active = state.tabs[1];
  state = openWorkbenchTab(state, tabTarget('knowledge', active.search));
  expect(state.tabs).toHaveLength(2);
  expect(state.active).toBe(active.key);
  expect(state.tabs[1].search).toContain('page=two');
});

test('pinning and ordering preserve editor identity and reload only changes its revision', () => {
  let state = createWorkbenchTabs('scope', tabTarget('knowledge'));
  state = openWorkbenchTab(state, tabTarget('members'));
  state = pinWorkbenchTab(state, 'members');
  expect(state.tabs[0].key).toBe('members');
  const instance = state.tabs[0].instance;
  state = reorderWorkbenchTabs(state, [0, instance]);
  expect(state.tabs[0].key).toBe('members');
  state = reloadWorkbenchTab(state, 'members');
  expect(state.tabs[0].instance).toBe(instance);
  expect(state.tabs[0].revision).toBe(1);
});

test('restoration rejects other account/knowledge scopes and removed product routes', () => {
  const state = createWorkbenchTabs('account:server:project-a', tabTarget('knowledge'));
  expect(restoreWorkbenchTabs('account:server:project-b', state)).toBeNull();
  expect(restoreWorkbenchTabs(state.scope, { ...state, tabs: [{ ...state.tabs[0], view: 'tasks' }] })).toBeNull();
  expect(restoreWorkbenchTabs(state.scope, state)?.active).toBe('knowledge');
});

test('folder tab titles and route restore within their knowledge base without inventing a document target', () => {
  const state = createWorkbenchTabs('scope', tabTarget('knowledge', '?knowledgeBase=kb&source=server&folder=folder'));
  state.tabs[0].title = 'Research';
  const restored = restoreWorkbenchTabs('scope', state)!;
  expect(restored.tabs[0].title).toBe('Research');
  expect(restored.tabs[0].search).toContain('folder=folder');
  expect(restored.tabs[0].document).toBeUndefined();
  expect(restoreWorkbenchTabs('other', state)).toBeNull();
});

test('tab restoration and members navigation retain the top-selected knowledge workspace', () => {
  const selected = '?knowledgeBase=base-a&source=local&document=doc-a';
  expect(new URLSearchParams(knowledgeScopedSearch('', selected)).get('knowledgeBase')).toBe('base-a');
  expect(new URLSearchParams(knowledgeScopedSearch('?view=members', selected)).get('source')).toBe('local');
  const params = new URLSearchParams(knowledgeScopedSearch('?knowledgeBase=wrong&source=server&tab=tab%3A2', selected));
  expect(params.get('knowledgeBase')).toBe('base-a');
  expect(params.get('source')).toBe('local');
  expect(params.get('tab')).toBe('tab:2');
});

test('split tabs share one workbench group, survive restore, and close to the surviving document', () => {
  let state = createWorkbenchTabs('scope', tabTarget('knowledge', '?document=one&knowledgeBase=base&source=local'));
  state = splitWorkbenchTab(state, state.active, { title: 'One', target: { knowledgeBaseId: 'base', pageId: 'one', source: 'local' } });
  expect(state.tabs).toHaveLength(2);
  expect(state.split).toEqual({ left: 'knowledge', right: 'tab:1', ratio: 50 });
  expect(state.tabs[1].document?.title).toBe('One');
  const restored = restoreWorkbenchTabs('scope', JSON.parse(JSON.stringify(state)))!;
  expect(restored.split).toEqual(state.split);
  state = closeWorkbenchTab(restored, state.active);
  expect(state.split).toBeUndefined(); expect(state.active).toBe('knowledge');
  expect(state.tabs[0].search).toContain('document=one');
});
