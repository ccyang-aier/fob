'use client';

import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { documentFonts, documentCodeFonts, documentSizes, documentWidth, documentLineHeights, documentParagraphSpacings } from '@/lib/editor-appearance-options';

export type DocumentAppearance = {
  width: number;
  font: typeof documentFonts[number]['id'];
  codeFont: typeof documentCodeFonts[number]['id'];
  size: typeof documentSizes[number]['id'];
  lineHeight: typeof documentLineHeights[number];
  paragraphSpacing: typeof documentParagraphSpacings[number]['id'];
};
const defaults: DocumentAppearance = { width: documentWidth.default, font: 'default', codeFont: 'default', size: 'standard', lineHeight: 1.8, paragraphSpacing: 'standard' };

function readPreferences(value: unknown): DocumentAppearance {
  if (!value || typeof value !== 'object') return defaults;
  const prefs = value as Partial<DocumentAppearance>;
  return {
    width: typeof prefs.width === 'number' && Number.isInteger(prefs.width) && prefs.width >= documentWidth.min && prefs.width <= documentWidth.max ? prefs.width : defaults.width,
    font: documentFonts.some(item => item.id === prefs.font) ? prefs.font! : defaults.font,
    codeFont: documentCodeFonts.some(item => item.id === prefs.codeFont) ? prefs.codeFont! : defaults.codeFont,
    size: documentSizes.some(item => item.id === prefs.size) ? prefs.size! : defaults.size,
    lineHeight: documentLineHeights.includes(prefs.lineHeight!) ? prefs.lineHeight! : defaults.lineHeight,
    paragraphSpacing: documentParagraphSpacings.some(item => item.id === prefs.paragraphSpacing) ? prefs.paragraphSpacing! : defaults.paragraphSpacing,
  };
}

function createAppearanceStore(key: string) {
  let value = defaults;
  let loaded = false;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getServerSnapshot: () => defaults,
    getSnapshot() {
      if (!loaded) {
        loaded = true;
        try { value = readPreferences(JSON.parse(localStorage.getItem(key) ?? 'null')); }
        catch { /* View preferences remain available in memory. */ }
      }
      return value;
    },
    update(patch: Partial<DocumentAppearance>) {
      value = readPreferences({ ...value, ...patch });
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* No document content depends on this preference. */ }
      listeners.forEach(listener => listener());
    },
  };
}

const AppearanceContext = createContext<{ appearance: DocumentAppearance; update: (patch: Partial<DocumentAppearance>) => void } | null>(null);
export function DocumentAppearanceProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [store] = useState(() => createAppearanceStore(`fob.document.appearance:${scope}`));
  const appearance = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return <AppearanceContext.Provider value={{ appearance, update: store.update }}>{children}</AppearanceContext.Provider>;
}
export function useDocumentAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('DocumentAppearanceProvider is required');
  return context;
}
