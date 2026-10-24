'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/font-section.messages';

/**
 * 产品字体分区：界面与代码；文档排版在文档自己的个性化设置中管理。
 * 行内示例以当前选择实时渲染（字体族 + 字号），所见即所得。
 */

import { CaretDown, Check, Minus, Plus } from '@phosphor-icons/react';

import {
  getCodeFontOptions,
  FONT_SIZE_RANGES,
  getUiFontOptions,
  type AppearancePrefs,
} from '@/lib/appearance';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { SettingsSection } from './section-card';

export function FontSection({
  prefs,
  onChange,
}: {
  prefs: AppearancePrefs;
  onChange: (patch: Partial<AppearancePrefs>) => void;
}) {
  const { t: uiText, locale } = useTranslation(messages);
  return (
    <SettingsSection title={uiText('字体')}>
      <div className="divide-y divide-[var(--line)]">
        <FontRow
          label={uiText('界面字体')}
          options={getUiFontOptions(locale)}
          selected={prefs.uiFont}
          onSelect={(uiFont) => onChange({ uiFont })}
          size={prefs.uiFontSize}
          range={FONT_SIZE_RANGES.ui}
          onSize={(uiFontSize) => onChange({ uiFontSize })}
          sample={uiText('interfaceSample')}
        />
        <FontRow
          label={uiText('代码字体')}
          options={getCodeFontOptions(locale)}
          selected={prefs.codeFont}
          onSelect={(codeFont) => onChange({ codeFont })}
          size={prefs.codeFontSize}
          range={FONT_SIZE_RANGES.code}
          onSize={(codeFontSize) => onChange({ codeFontSize })}
          sample={'const page = await knowledge.readPage("research")'}
          mono
        />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted-strong)]">{uiText('documentAppearanceHint')}</p>
    </SettingsSection>
  );
}

// ─── 行 ────────────────────────────────────────────────────────────

type FontOption<T extends string> = { id: T; label: string; stack: string };

function FontRow<T extends string>({
  label,
  options,
  selected,
  onSelect,
  size,
  range,
  onSize,
  sample,
  mono = false,
}: {
  label: string;
  options: ReadonlyArray<FontOption<T>>;
  selected: T;
  onSelect: (id: T) => void;
  size: number;
  range: { min: number; max: number };
  onSize: (size: number) => void;
  sample: string;
  mono?: boolean;
}) {
  const active = options.find((option) => option.id === selected) ?? options[0];
  const sampleStyle: React.CSSProperties = {
    fontSize: size,
    ...(active.stack
      ? { fontFamily: active.stack }
      : mono
        ? { fontFamily: 'var(--font-code)' }
        : undefined),
  };

  return (
    <div className="py-3.5 first:pt-0.5 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[12px] font-medium">{label}</h3>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <FontFamilyMenu options={options} selected={selected} onSelect={onSelect} label={label} />
          <SizeStepper value={size} range={range} onChange={onSize} label={label} />
        </div>
      </div>
      <p
        className="mt-2.5 truncate rounded-[8px] border border-[var(--line)] bg-[var(--surface-subtle)] px-3.5 py-2.5 text-[var(--ink-soft)]"
        style={sampleStyle}
      >
        {sample}
      </p>
    </div>
  );
}

function FontFamilyMenu<T extends string>({
  options,
  selected,
  onSelect,
  label,
}: {
  options: ReadonlyArray<FontOption<T>>;
  selected: T;
  onSelect: (id: T) => void;
  label: string;
}) {
  const uiText = useTranslation(messages).t;
  const active = options.find((option) => option.id === selected) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={uiText('{0}字体族', { '0': label })}
          className="flex h-8 w-[138px] items-center justify-between gap-2 rounded-[8px] border border-[var(--line)] bg-panel px-2.5 text-[11.5px] text-[var(--ink)] outline-none transition-[border-color,background-color] duration-150 hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)] focus-visible:border-[var(--accent)]"
        >
          <span
            className="truncate"
            style={active.stack ? { fontFamily: active.stack } : undefined}
          >
            {active.label}
          </span>
          <CaretDown className="size-3 shrink-0 text-[var(--muted)]" weight="bold" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => onSelect(option.id)}>
            <span
              className="flex-1 truncate"
              style={option.stack ? { fontFamily: option.stack } : undefined}
            >
              {option.label}
            </span>
            {option.id === selected ? (
              <Check className="size-3.5 text-[var(--accent-ink)]!" weight="bold" aria-hidden />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SizeStepper({
  value,
  range,
  onChange,
  label,
}: {
  value: number;
  range: { min: number; max: number };
  onChange: (value: number) => void;
  label: string;
}) {
  const uiText = useTranslation(messages).t;
  return (
    <div className="flex h-8 items-center overflow-hidden rounded-[8px] border border-[var(--line)] bg-panel">
      <StepperButton
        ariaLabel={uiText('减小{0}字号', { '0': label })}
        disabled={value <= range.min}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="size-3" weight="bold" aria-hidden />
      </StepperButton>
      <span
        className="w-[46px] text-center font-mono text-[10.5px] text-[var(--muted-strong)]"
        aria-live="polite"
      >
        {value} px
      </span>
      <StepperButton
        ariaLabel={uiText('增大{0}字号', { '0': label })}
        disabled={value >= range.max}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="size-3" weight="bold" aria-hidden />
      </StepperButton>
    </div>
  );
}

function StepperButton({
  ariaLabel,
  disabled,
  onClick,
  children,
}: {
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center text-[var(--muted-strong)] outline-none transition-colors duration-150',
        'hover:bg-wash hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
        'disabled:pointer-events-none disabled:opacity-35',
      )}
    >
      {children}
    </button>
  );
}
