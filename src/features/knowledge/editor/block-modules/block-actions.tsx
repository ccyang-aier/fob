import type { ReactNode } from 'react';
import styles from './block-actions.module.css';

/** The padded wrapper keeps the pointer over the block while crossing to its actions. */
export function BlockActions({ children, active = false, placement = 'outside', touchVisibility = 'always' }: { children: ReactNode; active?: boolean; placement?: 'outside' | 'inside' | 'canvas'; touchVisibility?: 'always' | 'on-demand' }) {
  return (
    <div className={styles.root} data-block-actions data-placement={placement} data-touch-visibility={touchVisibility} data-active={active || undefined} contentEditable={false} data-document-export-omit onMouseDownCapture={(event) => {
      if (!(event.target instanceof Element) || !event.target.closest('input, textarea, select, [role="dialog"]')) event.preventDefault();
    }}>
      <div className={styles.bar} role="group">{children}</div>
      {placement === 'outside' && <span className={styles.bridge} data-block-action-bridge aria-hidden />}
    </div>
  );
}
