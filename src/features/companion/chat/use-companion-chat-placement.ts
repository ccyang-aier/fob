import { useLayoutEffect, useRef, type RefObject } from 'react';
import { companionChatPlacement, companionChatViewport } from './companion-chat-geometry';

export function useCompanionChatPlacement(anchor: RefObject<HTMLElement | null>, open: boolean) {
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const trigger = anchor.current, node = surface.current;
    if (!open || !trigger || !node) return;
    function place() {
      if (!trigger || !node) return;
      const rect = trigger.getBoundingClientRect(), viewport = companionChatViewport(window);
      const bounds = companionChatPlacement(rect, viewport, node.getBoundingClientRect().height || 240);
      node.style.left = `${bounds.left}px`; node.style.top = `${bounds.top}px`;
      node.style.width = `${bounds.width}px`; node.style.maxHeight = `${bounds.maxHeight}px`;
      node.style.setProperty('--companion-chat-height', `${bounds.maxHeight}px`);
      node.dataset.side = bounds.side; node.dataset.tailUp = String(bounds.tailUp); node.dataset.placed = 'true';
    }
    const resize = new ResizeObserver(place); resize.observe(trigger); resize.observe(node);
    const move = new MutationObserver(place), widget = trigger.closest('[data-companion]');
    if (widget) move.observe(widget, { attributes: true, attributeFilter: ['style', 'data-open', 'data-dragging'] });
    const viewport = window.visualViewport;
    window.addEventListener('resize', place); viewport?.addEventListener('resize', place); viewport?.addEventListener('scroll', place);
    place();
    return () => { resize.disconnect(); move.disconnect(); window.removeEventListener('resize', place); viewport?.removeEventListener('resize', place); viewport?.removeEventListener('scroll', place); };
  }, [anchor, surface, open]);
  return surface;
}
