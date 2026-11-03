'use client';

import type { PermissionLevel } from '@fob/shared/knowledge/contracts';
import { MagnifyingGlass, SelectionCheck, X } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import type { MemberRole } from './client';
import { memberRoleLabels } from './view-model';
import { managementMessages } from './management.messages';
import styles from './management.module.css';

export function RoleLabel({ role }: { role: MemberRole }) {
  const { locale } = useTranslation(managementMessages);
  return <span className={styles.badge} data-role={role}>{memberRoleLabels(locale)[role]}</span>;
}
export function PermissionBadge({ level }: { level: PermissionLevel | null }) {
  const { t } = useTranslation(managementMessages);
  return level ? <span className={styles.badge} data-permission={level}>{t(level)}</span> : <span className={styles.none} aria-label={t('noAccess')}>—</span>;
}
export function TableCheck({ checked, mixed, onChange, label, disabled }: {
  checked: boolean; mixed?: boolean; onChange: () => void; label: string; disabled?: boolean;
}) {
  return <button type="button" role="checkbox" aria-checked={mixed ? 'mixed' : checked} aria-label={label} disabled={disabled}
    onClick={onChange} className={styles.check} data-checked={checked || mixed || undefined}>
    {mixed ? <span className={styles.minus} /> : checked ? <SelectionCheck aria-hidden /> : null}
  </button>;
}
export function DirectorySearch({ value, onChange, label, clearLabel, className }: {
  value: string; onChange: (value: string) => void; label: string; clearLabel: string; className?: string;
}) {
  return <label className={cn(styles.search, className)}><MagnifyingGlass size={16} aria-hidden />
    <input type="search" aria-label={label} placeholder={label} value={value} onChange={(event) => onChange(event.target.value)} />
    {value ? <button type="button" className="fob-action" data-surface="plain" aria-label={clearLabel} onClick={() => onChange('')}><X size={14} aria-hidden /></button> : null}
  </label>;
}
