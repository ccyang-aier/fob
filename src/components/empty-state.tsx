import { EmptyDocuments } from '@/components/icons';
import { cn } from '@/lib/utils';
import styles from './empty-state.module.css';

export function EmptyState({ label, className }: { label: string; className?: string }) {
  return <div className={cn(styles.empty, className)} role="status">
    <EmptyDocuments size={56} className={styles.illustration} aria-hidden />
    <p>{label}</p>
  </div>;
}
