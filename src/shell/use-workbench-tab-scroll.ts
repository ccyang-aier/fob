'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useWorkbenchTabScroll(active: string, revealRequest: number) {
  const strip = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const pending = useRef(0);
  const manual = useRef(false);
  const glide = useRef({ frame: 0, target: 0, time: null as number | null, direction: 0 });
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  const cancelReveal = useCallback(() => { cancelAnimationFrame(pending.current); pending.current = 0; }, []);
  const stopGlide = useCallback(() => { cancelAnimationFrame(glide.current.frame); glide.current.frame = 0; }, []);
  const beginBrowse = useCallback(() => {
    manual.current = true; cancelReveal(); stopGlide();
    const scroll = viewport.current;
    // Interrupt native auto-reveal as soon as the user takes control.
    scroll?.scrollTo({ left: scroll.scrollLeft, behavior: 'instant' });
  }, [cancelReveal, stopGlide]);
  const browse = useCallback((direction: number) => {
    beginBrowse();
    const scroll = viewport.current;
    scroll?.scrollBy({ left: direction * scroll.clientWidth * .7, behavior: 'smooth' });
  }, [beginBrowse]);
  const reveal = useCallback(() => {
    const scroll = viewport.current;
    const item = ref.current?.querySelector('[aria-selected="true"]')?.parentElement;
    if (!scroll || !item || dragging.current) return;
    // Layout offsets ignore drag/FLIP transforms and already reflect the final tab widths.
    const left = item.offsetLeft;
    const right = left + item.offsetWidth;
    const current = scroll.scrollLeft;
    const target = left < current ? left : right > current + scroll.clientWidth ? right - scroll.clientWidth : current;
    const next = Math.max(0, Math.min(scroll.scrollWidth - scroll.clientWidth, target));
    if (Math.abs(next - current) > 1) scroll.scrollTo({ left: next, behavior: 'smooth' });
  }, []);
  const revealSelected = useCallback(() => {
    manual.current = false; cancelReveal(); stopGlide();
    // Let overflow controls and ResizeObserver finish layout before issuing one scroll.
    pending.current = requestAnimationFrame(() => {
      pending.current = requestAnimationFrame(() => { pending.current = 0; reveal(); });
    });
  }, [cancelReveal, reveal, stopGlide]);

  useEffect(() => {
    const root = strip.current;
    const scroll = viewport.current;
    const content = ref.current;
    if (!root || !scroll || !content) return;
    let previousWidth = 0;
    let previousContentWidth = 0;
    function measure() {
      const end = Math.max(0, scroll!.scrollWidth - scroll!.clientWidth);
      const gap = Number.parseFloat(getComputedStyle(root!).columnGap) || 0;
      // Compare with the space before arrows are inserted, so they cannot toggle themselves.
      const available = root!.clientWidth - (newButton.current?.offsetWidth ?? 0) - gap;
      const next = { overflow: content!.offsetWidth > available + 1, left: scroll!.scrollLeft > 1, right: scroll!.scrollLeft < end - 1 };
      setEdges(current => current.overflow === next.overflow && current.left === next.left && current.right === next.right ? current : next);
      if (previousWidth !== scroll!.clientWidth || previousContentWidth !== content!.offsetWidth) {
        previousWidth = scroll!.clientWidth;
        previousContentWidth = content!.offsetWidth;
        if (!manual.current) revealSelected();
      }
    }
    function tick(now: number) {
      const state = glide.current;
      state.target = Math.max(0, Math.min(scroll!.scrollWidth - scroll!.clientWidth, state.target));
      const distance = state.target - scroll!.scrollLeft;
      const elapsed = state.time === null ? 16 : now - state.time;
      state.time = now;
      // Time-based damping keeps wheel bursts continuous and the short coast consistent across refresh rates.
      const step = Math.min(Math.abs(distance), Math.max(1, Math.abs(distance) * (1 - Math.exp(-elapsed / 80))));
      scroll!.scrollLeft += Math.sign(distance) * step;
      if (Math.abs(state.target - scroll!.scrollLeft) < 1) {
        scroll!.scrollLeft = state.target; state.frame = 0;
      } else state.frame = requestAnimationFrame(tick);
    }
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || scroll!.scrollWidth <= scroll!.clientWidth + 1 || !event.deltaX && !event.deltaY) return;
      manual.current = true;
      cancelReveal();
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) { stopGlide(); return; }
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll!.clientWidth : 1;
      const state = glide.current;
      const direction = Math.sign(event.deltaY);
      if (!state.frame) { scroll!.scrollTo({ left: scroll!.scrollLeft, behavior: 'instant' }); state.time = null; }
      // Reversing starts from the visible position instead of fighting the previous target.
      if (!state.frame || direction !== state.direction) state.target = scroll!.scrollLeft;
      state.direction = direction;
      state.target = Math.max(0, Math.min(scroll!.scrollWidth - scroll!.clientWidth, state.target + event.deltaY * unit));
      if (!state.frame && Math.abs(state.target - scroll!.scrollLeft) > .5) state.frame = requestAnimationFrame(tick);
    }
    const observer = new ResizeObserver(measure);
    for (const element of [root, scroll, content]) observer.observe(element);
    scroll.addEventListener('scroll', measure, { passive: true });
    scroll.addEventListener('wheel', wheel, { passive: false });
    scroll.addEventListener('pointerdown', beginBrowse);
    measure();
    return () => {
      observer.disconnect(); cancelReveal(); stopGlide();
      scroll.removeEventListener('scroll', measure);
      scroll.removeEventListener('wheel', wheel);
      scroll.removeEventListener('pointerdown', beginBrowse);
    };
  }, [beginBrowse, cancelReveal, revealSelected, stopGlide]);
  useEffect(revealSelected, [active, revealRequest, revealSelected]);
  return { strip, viewport, ref, newButton, dragging, edges, revealSelected, browse };
}
