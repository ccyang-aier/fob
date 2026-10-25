import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motion } from 'motion/react';
import styles from './companion-widget.module.css';

/** Speech is a passive status bubble, so it must never own Escape or move focus. */
export function CompanionSpeech({ anchor, text }: { anchor: RefObject<HTMLElement | null>; text: string }) {
  const bubble = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const trigger = anchor.current, node = bubble.current;
    if (!trigger || !node) return;
    function place() {
      if (!trigger || !node) return;
      const rect = trigger.getBoundingClientRect();
      const width = node.offsetWidth, height = node.offsetHeight;
      const leftSpace = rect.left - 26, rightSpace = innerWidth - rect.right - 26;
      let left: number, top: number;
      if (leftSpace >= width || rightSpace >= width) {
        left = leftSpace >= width ? rect.left - width - 14 : rect.right + 14;
        top = rect.top + (rect.height - height) / 2;
      } else {
        left = rect.left + (rect.width - width) / 2;
        top = rect.top >= height + 26 ? rect.top - height - 14 : rect.bottom + 14;
      }
      node.style.left = Math.max(12, Math.min(left, innerWidth - width - 12)) + 'px';
      node.style.top = Math.max(12, Math.min(top, innerHeight - height - 12)) + 'px';
    }
    const resize = new ResizeObserver(place); resize.observe(node); resize.observe(trigger);
    const move = new MutationObserver(place);
    const widget = trigger.closest('[data-companion]');
    if (widget) move.observe(widget, { attributes: true, attributeFilter: ['style', 'data-open'] });
    window.addEventListener('resize', place); place();
    return () => { resize.disconnect(); move.disconnect(); window.removeEventListener('resize', place); };
  }, [anchor, text]);
  return <motion.div ref={bubble} className={styles.speech} role="status" aria-live="polite" aria-atomic="true" data-companion-speech
    initial={{ opacity: 0, y: 4, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 3, scale: .98 }}
    transition={{ duration: .18, ease: [.22, 1, .36, 1] }}>{text}</motion.div>;
}
