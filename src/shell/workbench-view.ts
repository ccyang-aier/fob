'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getNavigationSnapshot, getServerNavigationSnapshot, goBack, goForward, pushWorkbenchLocation, replaceWorkbenchLocation, startNavigationHistory, subscribeNavigationHistory, WORKBENCH_VIEW_CHANGED } from '@/lib/navigation-history';

export type WorkbenchView = 'knowledge' | 'members' | 'templates' | 'settings';
const views: readonly WorkbenchView[] = ['knowledge', 'members', 'templates', 'settings'];
const viewChanged = WORKBENCH_VIEW_CHANGED;
function resolveView(value: string | null): WorkbenchView {
  return views.includes(value as WorkbenchView) ? value as WorkbenchView : 'knowledge';
}
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(viewChanged, listener);
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener(viewChanged, listener); };
}
export function useWorkbenchView(scopeKey: string | null, allowMembers = true) {
  useEffect(() => startNavigationHistory(scopeKey), [scopeKey]);
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('view') !== 'profile' && (allowMembers || url.searchParams.get('view') !== 'members')) return;
    const retired = url.searchParams.get('view');
    url.searchParams.delete('view');
    if (url.searchParams.get('tab') === retired) url.searchParams.delete('tab');
    replaceWorkbenchLocation(url);
  }, [search, allowMembers]);
  const navigation = useSyncExternalStore(subscribeNavigationHistory, getNavigationSnapshot, getServerNavigationSnapshot);
  const params = new URLSearchParams(search);
  const settingsOpen = params.get('view') === 'settings';
  const requestedView = resolveView(params.get(settingsOpen ? 'returnView' : 'view'));
  const view = requestedView === 'settings' || (!allowMembers && requestedView === 'members') ? 'knowledge' : requestedView;
  return [view, (next: WorkbenchView) => {
    const url = new URL(window.location.href);
    if (next === 'settings' && url.searchParams.get('view') !== 'settings') {
      url.searchParams.set('returnView', resolveView(url.searchParams.get('view')));
    }
    if (next === 'knowledge') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    if (next !== 'settings') { url.searchParams.delete('section'); url.searchParams.delete('returnView'); }
    if (next === 'settings' || settingsOpen) replaceWorkbenchLocation(url);
    else pushWorkbenchLocation(url);
  }, settingsOpen, { ...navigation, goBack, goForward }, search] as const;
}
