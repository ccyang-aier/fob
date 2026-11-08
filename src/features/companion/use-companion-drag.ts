import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { companionDragPosition } from './companion-drag-bounds';

/** Drag the embedding shell, leaving Feather's hop/squash/tilt transforms untouched. */
export function useCompanionDrag(ref: RefObject<HTMLElement | null>) {
  const offset = useRef({ right: 16, bottom: 24 });
  const desired = useRef({ right: 16, bottom: 24 });
  const drag = useRef<{ id: number; x: number; y: number; right: number; bottom: number; handle: Element } | null>(null);
  const moved = useRef(false);

  const place = useCallback((right: number, bottom: number, remember = false) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const viewport = window.visualViewport;
    if (remember) desired.current = { right, bottom };
    offset.current = companionDragPosition({ right, bottom }, rect, { width: window.innerWidth, height: window.innerHeight }, {
      left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight,
    });
    node.style.right = offset.current.right + 'px'; node.style.bottom = offset.current.bottom + 'px';
  }, [ref]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const clamp = () => place(desired.current.right, desired.current.bottom);
    const observer = new ResizeObserver(clamp); observer.observe(node);
    window.addEventListener('resize', clamp);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', clamp); viewport?.addEventListener('scroll', clamp);
    clamp();
    return () => { observer.disconnect(); window.removeEventListener('resize', clamp); viewport?.removeEventListener('resize', clamp); viewport?.removeEventListener('scroll', clamp); };
  }, [ref, place]);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
    moved.current = false;
    if (!event.target.closest('[data-companion-drag]') || event.target.closest('button')) return;
    // Touch synthesizes a click only when down/up keep the same actual target.
    const handle = event.target;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ...offset.current, handle };
    handle.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!moved.current && Math.hypot(dx, dy) < 5) return;
    moved.current = true; event.currentTarget.dataset.dragging = 'true';
    place(start.right - dx, start.bottom - dy, true);
  }
  function finish(event: ReactPointerEvent<HTMLElement>) {
    if (drag.current?.id !== event.pointerId) return;
    const { handle } = drag.current;
    drag.current = null; delete event.currentTarget.dataset.dragging;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  return {
    onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
    onClickCapture(event: ReactMouseEvent<HTMLElement>) {
      if (!moved.current) return;
      moved.current = false; event.preventDefault(); event.stopPropagation();
    },
  };
}
