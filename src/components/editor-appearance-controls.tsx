'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/editor-appearance-controls.messages';

import { useId, type CSSProperties } from 'react';
import { CaretDown, Check } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  documentSizes,
  documentWidth,
  getDocumentAppearanceOptions,
} from '@/lib/editor-appearance-options';
import styles from './editor-appearance-controls.module.css';

type SelectOption<T> = { id: T; label: string; family?: string };

export function AppearanceSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const selected = options.find((option) => option.id === value);
  return (
    <div className={styles.field} data-menu-reveal>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={styles.select}
          aria-labelledby={labelId}
          disabled={disabled}
        >
          <span style={{ fontFamily: selected?.family }}>{selected?.label}</span>
          <CaretDown size={16} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-editor-appearance-dropdown
          side="bottom"
          align="start"
          avoidCollisions={false}
          sideOffset={6}
          className={styles.dropdown}
        >
          <ScrollArea className={styles.optionScroll}>
            {options.map((option) => (
              <DropdownMenuItem
                key={option.id}
                className={styles.option}
                onSelect={() => onChange(option.id)}
              >
                <span style={{ fontFamily: option.family }}>{option.label}</span>
                {option.id === value && (
                  <Check size={14} className={styles.check} aria-hidden />
                )}
              </DropdownMenuItem>
            ))}
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AppearanceWidthControl({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const uiText = useTranslation(messages).t;
  const id = useId();
  const percentage = ((value - documentWidth.min) / (documentWidth.max - documentWidth.min)) * 100;
  return (
    <div className={styles.field} data-menu-reveal>
      <div className={styles.widthHeading}>
        <label htmlFor={id} className={styles.label}>
          {label ?? uiText('页宽')}
        </label>
        <output htmlFor={id}>{value}%</output>
      </div>
      <input
        id={id}
        className={styles.range}
        type="range"
        min={documentWidth.min}
        max={documentWidth.max}
        step={1}
        value={value}
        style={{ '--range-progress': `${percentage}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        onKeyDown={(event) => {
          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
          )
            event.stopPropagation();
        }}
      />
    </div>
  );
}

export function AppearanceSizeControl({
  value,
  onChange,
}: {
  value: (typeof documentSizes)[number]['id'];
  onChange: (value: (typeof documentSizes)[number]['id']) => void;
}) {
  const { t: uiText, locale } = useTranslation(messages);
  const labelId = useId();
  return (
    <div className={styles.field} data-menu-reveal>
      <span className={styles.label} id={labelId}>
        {uiText('字号')}
      </span>
      <div className={styles.sizes} role="group" aria-labelledby={labelId}>
        {getDocumentAppearanceOptions(locale).sizes.map((option) => (
          <button
            type="button"
            key={option.id}
            aria-pressed={option.id === value}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
