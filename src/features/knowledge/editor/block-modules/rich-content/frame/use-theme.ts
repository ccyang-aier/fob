'use client';
import { useSyncExternalStore } from 'react';

const subscribe = (notify: () => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
};
export function useRichTheme() {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === 'dark', () => false);
}
