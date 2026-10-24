'use client';

import { useSyncExternalStore } from 'react';
import { PROJECT_AVATAR_PALETTES, type ProjectAvatarPalette } from './project-avatar';

const prefix = 'fob.project.avatar-palette.';
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(prefix)) listener(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}
export function useProjectAvatarPalette(scopeKey: string | null) {
  return useSyncExternalStore(subscribe, () => {
    if (!scopeKey) return undefined;
    try {
      const value = window.localStorage.getItem(prefix + scopeKey);
      return PROJECT_AVATAR_PALETTES.find(palette => palette.id === value)?.id;
    } catch { return undefined; }
  }, () => undefined);
}
export function saveProjectAvatarPalette(scopeKey: string, palette: ProjectAvatarPalette) {
  window.localStorage.setItem(prefix + scopeKey, palette);
  listeners.forEach(listener => listener());
}
