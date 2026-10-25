'use client';

import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { TabDocument } from '@/features/knowledge/editor/document-tab-context';
import { PAGE_SESSION_FLUSH, KnowledgeUiSessionContext } from '@/lib/page-session-state';
import { pushWorkbenchLocation, replaceWorkbenchLocation } from '@/lib/navigation-history';
import { closeSettings } from '@/lib/settings-navigation';
import { clampSplitRatio, reportWorkbenchDocument, splitWorkbenchTab } from './workbench-tabs';
import type { WorkbenchPage } from './workbench-pages';
import { addWorkbenchTab, closeWorkbenchTab, createWorkbenchStartup, createWorkbenchTabs, findWorkbenchTab, knowledgeScopedSearch, openWorkbenchTab, pinWorkbenchTab, reloadWorkbenchTab, reorderWorkbenchTabs, restoreWorkbenchTabs, tabTarget, workbenchPanelId, type TabCloseAction, type WorkbenchTab, type WorkbenchTabsState } from './workbench-tabs';

const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function useWorkbenchTabs(scope: string | null, view: WorkbenchPage, search: string, restorationReady = true, startup?: ReturnType<typeof createWorkbenchStartup>) {
  const session = useContext(KnowledgeUiSessionContext);
  const ready = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const boot = ready && restorationReady;
  const requested = tabTarget(view, search);
  const target = requested;
  const [revealRequest, setRevealRequest] = useState(0);
  const [memory, setMemory] = useState(() => ({ state: createWorkbenchTabs(scope, target), location: search, hydrated: false, hasKnowledgeBase: false, restoreSearch: null as string | null }));
  let current = memory;
  if (boot && (!current.hydrated || current.state.scope !== scope)) {
    const first = !current.hasKnowledgeBase && !startup?.isConsumed();
    let restored = restoreWorkbenchTabs(scope, session?.get('tabs', null)) ?? createWorkbenchTabs(scope, first ? target : tabTarget('knowledge'));
    const params = new URLSearchParams(search);
    const explicit = ['view', 'knowledgeBase', 'page', 'block'].some(key => params.has(key));
    if ((first && explicit) || params.has('document')) restored = openWorkbenchTab(restored, target);
    const selected = restored.tabs.find(tab => tab.key === restored.active)!;
    const selectedSearch = knowledgeScopedSearch(selected.search, search);
    current = { state: restored, location: search, hydrated: true, hasKnowledgeBase: current.hasKnowledgeBase || scope !== null, restoreSearch: selectedSearch !== requested.search ? selectedSearch : null };
  }
  if (boot) {
    if (current.restoreSearch !== null) {
      if (requested.search === current.restoreSearch) current = { ...current, location: search, restoreSearch: null };
    } else if (current.location !== search) {
      const next = openWorkbenchTab(current.state, target);
      if (next !== current.state || current.location !== search) current = { ...current, state: next, location: search };
    }
  }
  if (current !== memory) setMemory(current);
  const state = current.state;
  function setStored(change: WorkbenchTabsState | ((value: WorkbenchTabsState) => WorkbenchTabsState)) {
    setMemory(previous => ({ ...previous, state: typeof change === 'function' ? change(previous.state) : change }));
  }
  const restoreSearch = current.restoreSearch;
  const persisted = useRef<{ session: typeof session; snapshot: string } | null>(null);
  useEffect(() => {
    if (!boot || restoreSearch === null) return;
    const url = new URL(window.location.href);
    url.search = knowledgeScopedSearch(restoreSearch ?? target.search, url.search);
    replaceWorkbenchLocation(url);
  }, [boot, restoreSearch, target.search]);
  useEffect(() => {
    if (!boot || state.scope !== scope || !session) return;
    startup?.consume();
    const snapshot = JSON.stringify(state);
    if (persisted.current?.session === session && persisted.current.snapshot === snapshot) return;
    persisted.current = { session, snapshot };
    // Re-rendering an unchanged window must not overwrite a newer window's record.
    if (JSON.stringify(session.get('tabs', null)) !== snapshot) session.set('tabs', state, null);
    session.retainPages(state.tabs.map(tab => tab.instance));
  }, [boot, scope, session, state, startup]);

  function rememberLocation(current: WorkbenchTabsState) {
    return openWorkbenchTab(current, tabTarget(view, window.location.search));
  }
  function navigate(tab: WorkbenchTab, replace = false) {
    const url = new URL(window.location.href);
    url.search = knowledgeScopedSearch(tab.search, url.search);
    url.hash = '';
    if (replace) replaceWorkbenchLocation(url);
    else {
      if (new URLSearchParams(window.location.search).get('view') === 'settings') closeSettings();
      pushWorkbenchLocation(url);
    }
  }
  function commit(next: WorkbenchTabsState, replace = false) {
    setStored(next);
    // Explicit navigation can reveal even the current page; background updates cannot take over browsing.
    setRevealRequest(value => value + 1);
    navigate(next.tabs.find(tab => tab.key === next.active)!, replace);
  }
  function open(view: WorkbenchPage) {
    const remembered = rememberLocation(state);
    const target = tabTarget(view);
    const next = findWorkbenchTab(remembered, target) ?? target;
    commit(openWorkbenchTab(remembered, next));
  }
  function activate(key: string) {
    if (key === state.active) return;
    const remembered = rememberLocation(state);
    const tab = remembered.tabs.find(tab => tab.key === key);
    if (tab) commit({ ...remembered, active: tab.key, split: remembered.split && [remembered.split.left, remembered.split.right].includes(key) ? remembered.split : undefined });
  }
  function close(key: string, action: TabCloseAction = 'current') {
    const remembered = rememberLocation(state);
    const next = closeWorkbenchTab(remembered, key, action);
    const previous = remembered.tabs.find(tab => tab.key === remembered.active);
    const selected = next.tabs.find(tab => tab.key === next.active);
    if (previous?.instance !== selected?.instance) commit(next, true);
    else setStored(next);
  }
  function reorder(instances: number[]) {
    setStored(current => current.scope === scope ? reorderWorkbenchTabs(current, instances) : current);
  }
  function newTab(view: WorkbenchPage = 'knowledge') {
    commit(addWorkbenchTab(rememberLocation(state), tabTarget(view)));
  }
  function pin(key: string) {
    setStored(current => pinWorkbenchTab(current, key));
  }
  function flushPage(tab: WorkbenchTab) {
    document.getElementById(workbenchPanelId(tab.instance))?.dispatchEvent(new Event(PAGE_SESSION_FLUSH));
  }
  function reload(key: string) {
    const tab = state.tabs.find(tab => tab.key === key);
    if (!tab) return;
    flushPage(tab);
    setStored(current => reloadWorkbenchTab(current, key));
  }
  function duplicate(key: string) {
    const remembered = rememberLocation(state);
    const tab = remembered.tabs.find(tab => tab.key === key);
    if (!tab) return;
    flushPage(tab);
    if (session && !session.copyPage(tab.instance, remembered.nextInstance)) return;
    commit(addWorkbenchTab(remembered, tab, key));
  }
  const reportDocument = useCallback((key: string, document: TabDocument | null) => {
    setMemory(previous => ({ ...previous, state: reportWorkbenchDocument(previous.state, key, document) }));
  }, []);
  const resizeSplit = useCallback((ratio: number) => {
    setMemory(previous => previous.state.split ? { ...previous, state: { ...previous.state, split: { ...previous.state.split, ratio: clampSplitRatio(ratio) } } } : previous);
  }, []);
  const reportTitle = useCallback((key: string, title: string | null) => {
    setMemory(previous => {
      const tab = previous.state.tabs.find(item => item.key === key);
      if (!tab || tab.title === (title ?? undefined)) return previous;
      return { ...previous, state: { ...previous.state, tabs: previous.state.tabs.map(item => item.key === key ? { ...item, title: title ?? undefined } : item) } };
    });
  }, []);
  function split(key: string, document?: TabDocument) {
    const remembered = rememberLocation(state);
    const tab = remembered.tabs.find(tab => tab.key === key);
    if (tab) flushPage(tab);
    if (session && tab && !session.copyPage(tab.instance, remembered.nextInstance)) return;
    commit(splitWorkbenchTab(remembered, key, document));
  }
  function unsplit() { setStored(current => ({ ...current, split: undefined })); }
  return { ...state, revealRequest, ready: boot, open, activate, close, reorder, newTab, pin, reload, duplicate, reportDocument, reportTitle, splitTab: split, unsplit, resizeSplit };
}
