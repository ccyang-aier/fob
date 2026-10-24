'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './permission-select.messages';
import { CaretDown, Check, ShieldCheck } from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type PermissionOption = { value: string; label: string; description: string };

export function PermissionSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly PermissionOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const selected = options.find((option) => option.value === value)!;
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium text-[var(--muted-strong)]">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`${label}：${selected.label}`}
            className="group flex w-full items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 text-left outline-none transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-subtle)] text-[var(--muted-strong)]">
              <ShieldCheck size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium text-[var(--ink)]">
                {selected.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--muted-strong)]">
                {selected.description}
              </span>
            </span>
            <CaretDown
              aria-hidden
              size={13}
              className="shrink-0 text-[var(--muted)] transition-transform group-data-[state=open]:rotate-180"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          className="z-[100] w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-32px)] rounded-lg p-1.5 max-h-[320px] overflow-y-auto"
        >
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className={cn(
                'h-auto min-h-12 items-center gap-3 rounded-md px-3 py-2',
                value === option.value && 'bg-[var(--surface-subtle)]',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium">{option.label}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--muted-strong)]">
                  {option.description}
                </span>
              </span>
              {option.value === value ? (
                <Check
                  aria-label={knowledgeT('currentOption')}
                  size={15}
                  weight="bold"
                  className="shrink-0 text-[var(--accent-ink)]"
                />
              ) : (
                <span className="w-[15px] shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
