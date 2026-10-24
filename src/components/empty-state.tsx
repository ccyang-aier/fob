import { cn } from '@/lib/utils';
import styles from './empty-state.module.css';

export function EmptyState({ label, className }: { label: string; className?: string }) {
  return <div className={cn(styles.empty, className)} role="status">
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" className={styles.illustration} aria-hidden="true" focusable="false">
      <ellipse cx="40" cy="59" rx="25" ry="2.5" fill="currentColor" opacity=".08" />
      <rect x="18" y="9" width="34" height="42" rx="5" transform="rotate(-12 35 30)" className={styles.backSheet} strokeWidth="1.2" />
      <rect x="29" y="14" width="35" height="43" rx="5" className={styles.frontSheet} strokeWidth="1.2" />
      <path d="M38 26h17M38 33h17M38 40h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".65" />
      <path d="M12 30H8m4 8h-2M65 8V4m-2 2h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".65" />
    </svg>
    <p>{label}</p>
  </div>;
}
