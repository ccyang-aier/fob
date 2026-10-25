'use client';

import { CalendarBlank, X } from '@/components/icons';
import { useCallback, useId, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { DatePickerPanel } from './date-picker-panel';
import { parseDay, type DatePickerType } from './date-picker-model';
import { messages } from './date-picker.messages';
import styles from './date-picker.module.css';

export interface DatePickerProps extends Omit<ComponentProps<'button'>, 'type' | 'value' | 'onChange' | 'onInput' | 'children'> {
  type?: DatePickerType;
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  step?: string | number;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  clearable?: boolean;
  clearLabel?: string;
  iconOnly?: boolean;
}

export function DatePicker({ type = 'date', value, onValueChange, min, max, step, required = false, readOnly = false,
  clearable = !required, clearLabel, placeholder, iconOnly = false, disabled, className, name, onClick, onKeyDown, ...props }: DatePickerProps) {
  const { t, locale } = useTranslation(messages);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const open = anchor !== null;
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setAnchor(null), []);
  const day = parseDay(value.slice(0, 10));
  const date = day && type === 'datetime-local' ? new Date(value) : day;
  const display = date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(type === 'datetime-local' ? { hour: '2-digit', minute: '2-digit', ...(Number(step) < 60 ? { second: '2-digit' } : {}) } : {}),
  }).format(date) : '';
  const label = type === 'date' ? t('chooseDate') : t('chooseDateTime');
  return <span className={cn(styles.control, className)} data-icon-only={iconOnly || undefined} data-date-picker>
    <button {...props} ref={trigger} type="button" role="combobox" aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? panelId : undefined} aria-required={required || undefined} aria-readonly={readOnly || undefined}
      aria-label={props['aria-label'] ?? (iconOnly ? label : undefined)} disabled={disabled || readOnly}
      data-date-picker-trigger className={cn('fob-action', styles.trigger)} data-surface="muted"
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) setAnchor(open ? null : event.currentTarget); }}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && event.key === 'ArrowDown') { event.preventDefault(); setAnchor(event.currentTarget); } }}>
      {!iconOnly && <span className={styles.value} data-empty={!display || undefined}>{display || placeholder || label}</span>}
      <CalendarBlank size={16} className={styles.icon} aria-hidden />
    </button>
    {clearable && value && !disabled && !readOnly && !iconOnly && <Button type="button" variant="ghost" size="icon-sm" className={styles.clear}
      data-variant="destructive" aria-label={clearLabel ?? t('clear')} onClick={() => { onValueChange(''); close(); trigger.current?.focus(); }}><X size={12} /></Button>}
    {(name || required) && <input className={styles.formValue} type="text" name={name} value={value} required={required} disabled={disabled || readOnly} tabIndex={-1} aria-hidden
      onChange={() => {}} onInvalid={event => { event.preventDefault(); trigger.current?.focus(); setAnchor(trigger.current); }} />}
    {anchor && !disabled && !readOnly && <DatePickerPanel id={panelId} anchor={anchor} value={value} type={type} min={min} max={max} step={step}
      onClose={close} onConfirm={next => { onValueChange(next); close(); }} />}
  </span>;
}
