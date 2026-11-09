import { useLayoutEffect, type RefObject } from 'react';

const duration = 560, stagger = 100;

/** Transformed entrance layers extend scrollHeight; follow the actual layout instead. */
export function followCompanionBubbleLayout(node: HTMLElement) {
  const last = node.lastElementChild as HTMLElement | null;
  const padding = parseFloat(node.ownerDocument.defaultView?.getComputedStyle(node).paddingBottom ?? '0') || 0;
  node.scrollTo({ top: last?.offsetHeight ? Math.max(0, last.offsetTop + last.offsetHeight + padding - node.clientHeight) : node.scrollHeight });
}

/** Measure once, then let the compositor bring each visible bubble up from the bottom. */
export function revealCompanionBubbles(node: HTMLElement) {
  node.scrollTop = node.scrollHeight;
  const host = node.ownerDocument.defaultView;
  const motion = host?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const height = node.clientHeight;
  if (!host || motion?.matches || !height) return () => {};

  const viewport = node.getBoundingClientRect();
  const candidates = node.querySelectorAll<HTMLElement>('[data-companion-bubble]');
  const bubbles: { bubble: HTMLElement; bounds: DOMRect }[] = [];
  for (let index = candidates.length - 1; index >= 0 && bubbles.length < 6; index--) {
    const bubble = candidates[index], bounds = bubble.getBoundingClientRect();
    if (bounds.bottom <= viewport.top) break;
    if (bounds.top < viewport.bottom) bubbles.unshift({ bubble, bounds });
  }
  if (!bubbles.length) return () => {};

  let stopped = false, remaining = bubbles.length;
  const events = new AbortController();
  function finish(report: boolean) {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout); events.abort();
    for (const { bubble } of bubbles) {
      bubble.removeAttribute('data-entering');
      bubble.style.removeProperty('--bubble-from-y');
      bubble.style.removeProperty('--bubble-delay');
    }
    node.removeAttribute('data-bubble-opening');
    if (report && node.isConnected) node.dispatchEvent(new Event('scroll'));
  }
  const interrupt = () => finish(true);
  const timeout = setTimeout(interrupt, duration + (bubbles.length - 1) * stagger + 100);
  node.setAttribute('data-bubble-opening', 'true');
  for (const [index, { bubble, bounds }] of bubbles.entries()) {
    const distance = Math.min(height + 24, Math.max(36, viewport.bottom - bounds.top + 12));
    bubble.style.setProperty('--bubble-from-y', `${distance}px`);
    bubble.style.setProperty('--bubble-delay', `${index * stagger}ms`);
    bubble.setAttribute('data-entering', 'true');
    bubble.addEventListener('animationend', event => {
      if (event.target !== bubble) return;
      bubble.removeAttribute('data-entering');
      bubble.style.removeProperty('--bubble-from-y');
      bubble.style.removeProperty('--bubble-delay');
      if (--remaining === 0) finish(true);
    }, { signal: events.signal });
  }
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) node.addEventListener(event, interrupt, { passive: true, signal: events.signal });
  motion?.addEventListener('change', () => { if (motion.matches) finish(true); }, { signal: events.signal });
  return () => finish(false);
}

export function useCompanionBubbleEntrance({ transcriptRef, followRef, open, pending, historyOpen, conversationKey }: {
  transcriptRef: RefObject<HTMLDivElement | null>;
  followRef: RefObject<boolean>;
  open: boolean;
  pending: boolean;
  historyOpen: boolean;
  conversationKey: string;
}) {
  useLayoutEffect(() => {
    if (!open || pending || historyOpen) return;
    const node = transcriptRef.current;
    if (!node) return;
    followRef.current = true;
    return revealCompanionBubbles(node);
  }, [transcriptRef, followRef, open, pending, historyOpen, conversationKey]);
}
