import { expect, test } from 'bun:test';
import { addWorkbenchTab, closeWorkbenchTab, createWorkbenchTabs, openWorkbenchTab, pinWorkbenchTab, reloadWorkbenchTab, reorderWorkbenchTabs, restoreWorkbenchTabs, tabTarget } from './workbench-tabs';

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

test('restoration rejects other account/project scopes and removed product routes', () => {
  const state = createWorkbenchTabs('account:server:project-a', tabTarget('knowledge'));
  expect(restoreWorkbenchTabs('account:server:project-b', state)).toBeNull();
  expect(restoreWorkbenchTabs(state.scope, { ...state, tabs: [{ ...state.tabs[0], view: 'tasks' }] })).toBeNull();
  expect(restoreWorkbenchTabs(state.scope, state)?.active).toBe('knowledge');
});
