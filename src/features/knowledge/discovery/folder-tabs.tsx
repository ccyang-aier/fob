'use client';

import { useId, type KeyboardEvent } from 'react';
import { motion, MotionConfig } from 'motion/react';
import type { FolderTab } from '@fob/shared/knowledge/contracts';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './discovery.module.css';

const tabs: FolderTab[] = ['overview', 'documents', 'popular', 'updated', 'oldest', 'alphabetical'];

export function FolderTabs({ value, label, onChange }: { value: FolderTab; label: string; onChange(value: FolderTab): void }) {
  const { t } = useTranslation(messages);
  const indicatorId = useId();
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, tab: FolderTab) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[index]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  }
  return <MotionConfig reducedMotion="user">
    <motion.div layoutScroll className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map(tab => <button key={tab} type="button" role="tab" aria-selected={value === tab} tabIndex={value === tab ? 0 : -1} className={styles.tab} onClick={() => onChange(tab)} onKeyDown={event => keyDown(event, tab)}>
        {t(tab)}
        {value === tab && <motion.span aria-hidden className={styles.tabIndicator} layoutId={`folder-tab-${indicatorId}`} initial={false} transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
      </button>)}
    </motion.div>
  </MotionConfig>;
}
