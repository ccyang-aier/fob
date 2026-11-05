'use client';

import { useState, type ReactNode } from 'react';
import { CaretDown, SelectionCheck } from '@/components/icons';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSearch, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { managementMessages } from './management.messages';
import styles from './management.module.css';

export type DirectoryOption = {
  value: string;
  label: string;
  description?: string;
  leading?: ReactNode;
};

/** Shared menu behavior keeps field, member and permission pickers keyboard accessible. */
export function DirectorySelect({ label, value, options, onChange, placeholder, disabled = false,
  searchable = false, compact = false, valueDisplay }: {
  label: string;
  value: string;
  options: readonly DirectoryOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  compact?: boolean;
  valueDisplay?: ReactNode;
}) {
  const { t, locale } = useTranslation(managementMessages);
  const [search, setSearch] = useState('');
  const selected = options.find(option => option.value === value);
  const query = search.trim().toLocaleLowerCase(locale);
  const filtered = options.filter(option => `${option.label}\n${option.description ?? ''}`.toLocaleLowerCase(locale).includes(query));
  return <DropdownMenu onOpenChange={open => { if (!open) setSearch(''); }}>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={label} disabled={disabled}
        className={cn('fob-action', styles.selectTrigger, compact && styles.selectCompact)} data-surface="plain">
        <span className={styles.selectValue} data-placeholder={!selected || undefined}>
          {valueDisplay ?? <>{selected?.leading}<span className={styles.selectText}>{selected?.label ?? placeholder ?? label}</span></>}
        </span>
        <CaretDown size={12} aria-hidden className={styles.selectCaret} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className={styles.selectMenu} onEscapeKeyDown={event => event.stopPropagation()}>
      {searchable ? <DropdownMenuSearch value={search} onValueChange={setSearch} placeholder={t('searchOptions')} clearLabel={t('clearSearch')} /> : null}
      <div className={styles.selectOptions}>
        <DropdownMenuRadioGroup value={value} onValueChange={next => { if (next !== value) onChange(next); }}>
          {filtered.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} textValue={option.label}
            indicator="none" emphasizeSelection={false} className={styles.selectOption}>
            {option.leading}
            <span className={styles.optionCopy}><span className={styles.optionLabel}>{option.label}</span>
              {option.description ? <span className={styles.optionDescription}>{option.description}</span> : null}
            </span>
            <span className={styles.optionCheck} aria-hidden>{option.value === value ? <SelectionCheck /> : null}</span>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        {!filtered.length ? <p className={styles.selectEmpty}>{t('noResults')}</p> : null}
      </div>
    </DropdownMenuContent>
  </DropdownMenu>;
}
