'use client';

import { useSyncExternalStore } from 'react';
import type { SettingsSection } from '@/features/settings/settings-canvas';
import { replaceWorkbenchLocation, WORKBENCH_VIEW_CHANGED } from './navigation-history';

export function openSettings(section: SettingsSection = 'general') {
  const url = new URL(window.location.href);
  if (url.searchParams.get('view') !== 'settings') {
    url.searchParams.set('returnView', url.searchParams.get('view') ?? 'knowledge');
  }
  url.searchParams.set('view', 'settings');
  url.searchParams.set('section', section);
  replaceWorkbenchLocation(url);
}

export function setSettingsSection(section: SettingsSection) {
  const url = new URL(window.location.href);
  url.searchParams.set('section', section);
  replaceWorkbenchLocation(url);
}

export function closeSettings() {
  const url = new URL(window.location.href);
  const target = url.searchParams.get('returnView');
  if (target === 'members') url.searchParams.set('view', target);
  else url.searchParams.delete('view');
  url.searchParams.delete('returnView');
  url.searchParams.delete('section');
  replaceWorkbenchLocation(url);
}

function readSection(): SettingsSection {
  const section = new URLSearchParams(window.location.search).get('section');
  return ['appearance', 'general', 'about'].includes(section ?? '')
    ? (section as SettingsSection)
    : 'appearance';
}
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(WORKBENCH_VIEW_CHANGED, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(WORKBENCH_VIEW_CHANGED, listener);
  };
}
export function useSettingsSection() {
  return useSyncExternalStore(subscribe, readSection, () => 'appearance' as SettingsSection);
}
