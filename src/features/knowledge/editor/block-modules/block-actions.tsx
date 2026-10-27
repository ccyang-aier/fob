import type { ReactNode } from 'react';
import styles from './block-actions.module.css';

/** The padded wrapper keeps the pointer over the block while crossing to its actions. */
export function BlockActions({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <div className={styles.root} data-block-actions data-active={active || undefined} contentEditable={false} data-document-export-omit onMouseDownCapture={(event) => event.preventDefault()}>
      <div className={styles.bar} role="group">{children}</div>
      <span className={styles.bridge} data-block-action-bridge aria-hidden />
    </div>
  );
}
