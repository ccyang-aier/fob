import type { ReactNode } from 'react';
import { EmptyDocument } from '@/components/icons';
import { cn } from '@/lib/utils';
import styles from './empty-state.module.css';

export function EmptyDocumentIllustration() {
  return <div className={styles.illustration} aria-hidden="true">
    <span /><EmptyDocument size={32} strokeWidth={1.15} /><span />
  </div>;
}

export function EmptyState({ label, description, actions, className }: {
  label: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return <div className={cn(styles.empty, className)} role="status">
    <EmptyDocumentIllustration />
    <h2>{label}</h2>
    {description && <p>{description}</p>}
    {actions && <div className={styles.actions}>{actions}</div>}
  </div>;
}
