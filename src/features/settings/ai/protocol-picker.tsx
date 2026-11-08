'use client';

import type { AssistantConnectionProtocol } from '@fob/shared/knowledge/contracts';
import { CaretDown } from '@/components/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/lib/i18n';
import { aiSettingsMessages } from './messages';
import { protocolLabels } from './connection-state';
import styles from './ai-settings.module.css';

export function ProtocolPicker({ value, disabled, onChange }: { value: AssistantConnectionProtocol; disabled: boolean; onChange(value: AssistantConnectionProtocol): void }) {
  const { t } = useTranslation(aiSettingsMessages);
  return <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={`fob-action ${styles.control} ${styles.protocolPicker}`} data-surface="plain" aria-label={t('protocol')} disabled={disabled}><span>{protocolLabels[value]}</span><CaretDown size={12} aria-hidden /></button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" onEscapeKeyDown={event => event.stopPropagation()}><DropdownMenuRadioGroup value={value} onValueChange={next => onChange(next as AssistantConnectionProtocol)}>{Object.entries(protocolLabels).map(([id, label]) => <DropdownMenuRadioItem key={id} value={id} emphasizeSelection={false}>{label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
  </DropdownMenu>;
}
