'use client';

import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type NavigationHost = {
  target: HTMLDivElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
  expand: () => void;
  compact: boolean;
  setCompact: (compact: boolean) => void;
};
type NavigationSource = { selected: boolean; visible: boolean; activate: () => void };
const Host = createContext<NavigationHost | null>(null);
const Source = createContext<NavigationSource | null>(null);
const Compact = createContext(false);

/** The shell supplies one destination; resource adapters retain their own queries and actions. */
export function KnowledgeNavigationProvider({ children, onExpand }: { children: ReactNode; onExpand: () => void }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  const value = useMemo(() => ({ target, setTarget, expand: onExpand, compact, setCompact }), [target, onExpand, compact]);
  return <Host value={value}>{children}</Host>;
}

export function KnowledgeNavigationScope({ selected, visible, activate, children }: NavigationSource & { children: ReactNode }) {
  const value = useMemo(() => ({ selected, visible, activate }), [selected, visible, activate]);
  return <Source value={value}>{children}</Source>;
}

export function useKnowledgeNavigationActive() {
  return useContext(Source)?.selected ?? true;
}

export function useKnowledgeNavigation() {
  const host = useContext(Host);
  return { expand: host?.expand ?? (() => {}) };
}

export function useKnowledgeNavigationCompact() {
  return useContext(Compact);
}

export function KnowledgeNavigationOutlet({ compact = false }: { compact?: boolean }) {
  const host = useContext(Host);
  const setCompact = host?.setCompact;
  useLayoutEffect(() => { setCompact?.(compact); }, [compact, setCompact]);
  return <div ref={host?.setTarget} className="flex min-h-0 flex-1 flex-col overflow-hidden" data-compact={compact} data-knowledge-navigation-outlet />;
}

export function KnowledgeNavigationPortal({ children }: { children: ReactNode }) {
  const host = useContext(Host);
  const source = useContext(Source);
  if (!host?.target || source?.selected === false) return null;
  return createPortal(<Compact value={host.compact}><div className="flex min-h-0 flex-1 flex-col" onClickCapture={() => { if (source && !source.visible) source.activate(); }}>{children}</div></Compact>, host.target);
}
