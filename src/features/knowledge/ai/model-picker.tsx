'use client';

import { useState } from 'react';
import type { AssistantConnection, AssistantModelSelection } from '@fob/shared/knowledge/contracts';
import { CaretDown, GearSix, SelectionCheck } from '@/components/icons';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSearch, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useTranslation, defineMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import styles from './model-picker.module.css';

const messages = defineMessages({
  search: ['搜索服务商或模型…', 'Search providers or models…'], clear: ['清除搜索', 'Clear search'],
  empty: ['没有匹配的模型', 'No matching models'], missing: ['模型已不可用', 'Model unavailable'],
  manage: ['管理服务商', 'Manage providers'],
});

export function AIModelPicker({ connections, value, onChange, defaultLabel, label, disabled, onManage, className }: {
  connections: readonly AssistantConnection[];
  value: AssistantModelSelection | null;
  onChange(value: AssistantModelSelection | null): void;
  defaultLabel: string;
  label: string;
  disabled?: boolean;
  onManage?(): void;
  className?: string;
}) {
  const { t } = useTranslation(messages), [search, setSearch] = useState('');
  const provider = value ? connections.find(item => item.id === value.connectionId) : null;
  const model = provider?.models.find(item => item.id === value?.modelId);
  const query = search.trim().toLocaleLowerCase();
  const groups = connections.map(connection => ({ connection, models: connection.models.filter(item => `${connection.name} ${item.name} ${item.id}`.toLocaleLowerCase().includes(query)) })).filter(group => group.models.length);
  const showDefault = !query || defaultLabel.toLocaleLowerCase().includes(query);
  return <DropdownMenu onOpenChange={open => { if (open) setSearch(''); }}>
    <DropdownMenuTrigger type="button" disabled={disabled} className={cn(styles.trigger, className)} aria-label={label}>
      <span title={model ? `${provider?.name} · ${model.id}` : undefined}>{value ? model?.name || model?.id || t('missing') : defaultLabel}</span><CaretDown size={12} aria-hidden />
    </DropdownMenuTrigger>
    <DropdownMenuContent density="compact" align="start" className={styles.menu}>
      <DropdownMenuSearch value={search} onValueChange={setSearch} placeholder={t('search')} clearLabel={t('clear')} />
      <div className={styles.options}>
        {showDefault && <DropdownMenuItem role="menuitemradio" aria-checked={value === null} onSelect={() => onChange(null)} className={styles.option}><span>{defaultLabel}</span>{value === null && <SelectionCheck aria-hidden />}</DropdownMenuItem>}
        {groups.map(({ connection, models }) => <div key={connection.id}>
          <DropdownMenuLabel className={styles.group}>{connection.name}</DropdownMenuLabel>
          {models.map(item => <DropdownMenuItem key={item.id} role="menuitemradio" aria-checked={value?.connectionId === connection.id && value.modelId === item.id} className={styles.option} onSelect={() => onChange({ connectionId: connection.id, modelId: item.id })}>
            <span><span className={styles.name}>{item.name || item.id}</span>{item.name && item.name !== item.id && <small>{item.id}</small>}</span>
            {value?.connectionId === connection.id && value.modelId === item.id && <SelectionCheck aria-hidden />}
          </DropdownMenuItem>)}
        </div>)}
        {!showDefault && !groups.length && <p className={styles.empty}>{t('empty')}</p>}
      </div>
      {onManage && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={onManage}><GearSix size={14} aria-hidden />{t('manage')}</DropdownMenuItem></>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
