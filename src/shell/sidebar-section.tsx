'use client';

import { CaretRight } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import styles from './sidebar-sections.module.css';

export function SidebarSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  return <section className={styles.section} aria-label={title}>
    <div className={`sidebar-nav-row ${styles.heading}`} data-kind="section">
      <h2><button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>
        <CaretRight size={12} weight="bold" className={styles.caret} data-expanded={expanded} /><span>{title}</span>
      </button></h2>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
    <div id={contentId} hidden={!expanded} className={styles.children}>{children}</div>
  </section>;
}
