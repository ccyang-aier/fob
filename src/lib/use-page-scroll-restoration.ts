'use client';

import { useContext, useEffect, type RefObject } from 'react';
import { PAGE_SESSION_FLUSH, KnowledgeUiSessionContext } from './page-session-state';

/** Stable viewport keys survive asynchronous lists, editor mounts and hidden tabs. */
export function usePageScrollRestoration(ref: RefObject<HTMLElement | null>) {
  const session = useContext(KnowledgeUiSessionContext);
  useEffect(() => {
    const root = ref.current;
    if (!root || !session) return;
    const observed = new Set<Element>();
    const markers = new Map<HTMLElement, string>();
    const pending = new Map<HTMLElement, { top: number; left: number }>();
    const dirty = new Map<string, { top: number; left: number }>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    function flush() {
      clearTimeout(timer);
      dirty.forEach((position, key) => session!.set(key, position, null));
      dirty.clear();
    }
    function restore() {
      pending.forEach((position, element) => {
        if (element.clientHeight === 0 || element.scrollHeight - element.clientHeight < position.top - 1 || element.scrollWidth - element.clientWidth < position.left - 1) return;
        pending.delete(element);
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      });
    }
    const resize = new ResizeObserver(restore);
    function discover() {
      for (const node of observed) if (!root!.contains(node)) { resize.unobserve(node); observed.delete(node); if (node instanceof HTMLElement) { pending.delete(node); markers.delete(node); } }
      root!.querySelectorAll<HTMLElement>('[data-page-scroll]').forEach(element => {
        if (markers.get(element) !== element.dataset.pageScroll) {
          markers.set(element, element.dataset.pageScroll!);
          pending.delete(element);
          const position = session!.get<{ top: number; left: number } | null>(element.dataset.pageScroll!, null);
          if (position && Number.isFinite(position.top) && Number.isFinite(position.left)) pending.set(element, position);
        }
        for (const node of [element, ...element.children]) if (!observed.has(node)) { observed.add(node); resize.observe(node); }
      });
      restore();
    }
    function onScroll(event: Event) {
      const element = event.target;
      if (!(element instanceof HTMLElement) || !element.dataset.pageScroll || !element.clientHeight || pending.has(element)) return;
      dirty.set(element.dataset.pageScroll, { top: element.scrollTop, left: element.scrollLeft });
      clearTimeout(timer);
      timer = setTimeout(flush, 100);
    }
    const cancelRestore = () => pending.clear();
    const mutation = new MutationObserver(discover);
    mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-page-scroll'] });
    root.addEventListener('scroll', onScroll, true);
    root.addEventListener(PAGE_SESSION_FLUSH, flush);
    root.addEventListener('pointerdown', cancelRestore, true);
    root.addEventListener('wheel', cancelRestore, { passive: true });
    root.addEventListener('keydown', cancelRestore, true);
    window.addEventListener('pagehide', flush);
    discover();
    return () => {
      flush(); resize.disconnect(); mutation.disconnect();
      root.removeEventListener('scroll', onScroll, true);
      root.removeEventListener(PAGE_SESSION_FLUSH, flush);
      root.removeEventListener('pointerdown', cancelRestore, true);
      root.removeEventListener('wheel', cancelRestore);
      root.removeEventListener('keydown', cancelRestore, true);
      window.removeEventListener('pagehide', flush);
    };
  }, [ref, session]);
}
