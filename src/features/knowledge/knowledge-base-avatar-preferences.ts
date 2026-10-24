'use client';

import { useSyncExternalStore } from 'react';
import { KNOWLEDGE_BASE_AVATAR_PALETTES, type KnowledgeBaseAvatarPalette } from './knowledge-base-avatar';

const prefix = 'fob.knowledge-base.avatar-palette.';
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(prefix)) listener(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}
export function useKnowledgeBaseAvatarPalette(scopeKey: string | null) {
  return useSyncExternalStore(subscribe, () => {
    if (!scopeKey) return undefined;
    try {
      const value = window.localStorage.getItem(prefix + scopeKey);
      return KNOWLEDGE_BASE_AVATAR_PALETTES.find(palette => palette.id === value)?.id;
    } catch { return undefined; }
  }, () => undefined);
}
export function saveKnowledgeBaseAvatarPalette(scopeKey: string, palette: KnowledgeBaseAvatarPalette) {
  window.localStorage.setItem(prefix + scopeKey, palette);
  listeners.forEach(listener => listener());
}
