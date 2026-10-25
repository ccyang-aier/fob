'use client';

import type { FolderMetadata } from '@fob/shared/knowledge/contracts';
import { CaretDown, SortAscending, SortDescending } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './discovery.module.css';

export function FolderSortMenu({ value, disabled, onChange }: { value: FolderMetadata['sort']; disabled?: boolean; onChange(value: NonNullable<FolderMetadata['sort']>): void }) {
  const { t } = useTranslation(messages);
  const sort = value ?? { field: 'position', direction: 'asc' };
  const label = t(sort.field === 'position' ? 'manual' : sort.field);
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button size="sm" variant="ghost" disabled={disabled} className={styles.sortControl} aria-label={`${t('sort')}：${label} · ${t(sort.direction === 'asc' ? 'ascending' : 'descending')}`}>
      {sort.direction === 'asc' ? <SortAscending size={16} /> : <SortDescending size={16} />}<span>{label}</span><CaretDown size={12} />
    </Button>
  </DropdownMenuTrigger><DropdownMenuContent align="end" aria-label={t('sort')}>
    <DropdownMenuRadioGroup value={sort.field} onValueChange={field => onChange({ ...sort, field: field as typeof sort.field })}>
      {(['position', 'title', 'updatedAt', 'createdAt'] as const).map(field => <DropdownMenuRadioItem key={field} value={field}>{t(field === 'position' ? 'manual' : field)}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup><DropdownMenuSeparator />
    <DropdownMenuRadioGroup value={sort.direction} onValueChange={direction => onChange({ ...sort, direction: direction as typeof sort.direction })}>
      <DropdownMenuRadioItem value="asc">{t('ascending')}</DropdownMenuRadioItem><DropdownMenuRadioItem value="desc">{t('descending')}</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </DropdownMenuContent></DropdownMenu>;
}
