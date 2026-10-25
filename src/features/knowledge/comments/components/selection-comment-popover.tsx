'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './selection-comment-popover.messages';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { CaretDown, Quotes } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import type { CommentComposePoint } from '../comment-compose-bridge';
import { commentPopoverPlacement } from './comment-popover-placement';
import styles from './selection-comment-popover.module.css';

export function SelectionCommentPopover({
  anchor,
  excerpt,
  children,
}: {
  anchor: CommentComposePoint;
  excerpt: string;
  children: ReactNode;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const place = () => {
      const position = commentPopoverPlacement(anchor, element.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      element.style.left = `${position.left}px`;
      element.style.top = `${position.top}px`;
      element.style.setProperty('--comment-pointer-x', `${position.pointer}px`);
      element.dataset.side = position.side;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={knowledgeT('newComment')}
      className={styles.popover}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={styles.quote}>
        <span className={styles.quoteIcon}>
          <Quotes size={16} weight="regular" aria-hidden />
        </span>
        <p title={excerpt}>{excerpt}</p>
      </div>
      {children}
      <CaretDown className={styles.pointer} size={18} weight="fill" aria-hidden />
    </motion.div>
  );
}
