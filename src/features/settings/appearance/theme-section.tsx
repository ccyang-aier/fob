'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/theme-section.messages';

/**
 * 主题分区：浅色 / 深色 / 跟随系统。
 * 卡片内嵌按真实令牌配色渲染的迷你工作台预览；跟随系统为对角拼接的双主题预览。
 */

import { Check, Monitor, Moon, Sun } from '@/components/icons';

import {
  THEME_PREFS,
  getThemePrefLabels,
  type ResolvedTheme,
  type ThemePref,
} from '@/lib/appearance';
import { cn } from '@/lib/utils';

import { SettingsSection } from './section-card';

/** 预览用解析后调色板，与 globals.css 的浅/深主题令牌一致 */
const PALETTES: Record<
  ResolvedTheme,
  {
    shell: string;
    side: string;
    panel: string;
    ink: string;
    line: string;
    muted: string;
    accent: string;
  }
> = {
  light: {
    shell: '#fafafa',
    side: '#fafafa',
    panel: '#ffffff',
    ink: '#202020',
    line: 'rgba(32,32,32,0.10)',
    muted: '#d9d9d9',
    accent: '#202020',
  },
  dark: {
    shell: '#111111',
    side: '#141414',
    panel: '#181818',
    ink: '#ededed',
    line: 'rgba(237,237,237,0.12)',
    muted: '#404040',
    accent: '#ededed',
  },
};

const THEME_ICONS: Record<ThemePref, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export function ThemeSection({
  value,
  resolved,
  onChange,
}: {
  value: ThemePref;
  resolved: ResolvedTheme;
  onChange: (theme: ThemePref) => void;
}) {
  const { t: uiText, locale } = useTranslation(messages);
  const themePrefLabels = getThemePrefLabels(locale);
  return (
    <SettingsSection title={uiText('主题')}>
      <div className="grid w-fit grid-cols-3 gap-2.5" role="radiogroup" aria-label={uiText('主题')}>
        {THEME_PREFS.map((id) => {
          const selected = value === id;
          const Icon = THEME_ICONS[id];
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(id)}
              className={cn(
                'group relative w-[186px] rounded-[10px] border p-2 text-left outline-none transition-[border-color,box-shadow,transform] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] hover:-translate-y-px',
                selected
                  ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]'
                  : 'border-[var(--line)] hover:border-[var(--line-strong)]',
              )}
            >
              <span
                className="relative block h-[104px] overflow-hidden rounded-[7px] border border-[var(--line)]"
                aria-hidden
              >
                {id === 'system' ? (
                  <>
                    <MiniWorkbench palette={PALETTES.light} />
                    <span
                      className="absolute inset-0"
                      style={{ clipPath: 'polygon(58% 0, 100% 0, 100% 100%, 48% 100%)' }}
                    >
                      <MiniWorkbench palette={PALETTES.dark} />
                    </span>
                  </>
                ) : (
                  <MiniWorkbench palette={PALETTES[id]} />
                )}
                {selected ? (
                  <span className="absolute right-2 top-2 flex size-[18px] items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm">
                    <Check className="size-3" />
                  </span>
                ) : null}
              </span>
              <span className="mt-2 flex items-center gap-1.5 px-0.5">
                <Icon className="size-3.5 shrink-0 text-[var(--muted)]" />
                <span
                  className={cn(
                    'text-[11.5px]',
                    selected ? 'font-medium text-[var(--ink)]' : 'text-[var(--muted-strong)]',
                  )}
                >
                  {themePrefLabels[id]}
                </span>
                {id === 'system' ? (
                  <span className="ml-auto text-[9.5px] text-[var(--muted)]">
                    {uiText('当前')}
                    {resolved === 'dark' ? uiText('深色') : uiText('浅色')}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}

/** 迷你工作台：侧栏 + 圆角主面板 + 内容线条，全部按百分比排布以适配任意卡片尺寸 */
function MiniWorkbench({ palette }: { palette: (typeof PALETTES)[ResolvedTheme] }) {
  return (
    <span className="absolute inset-0 block" style={{ backgroundColor: palette.shell }}>
      <span
        className="absolute inset-y-0 left-0 block w-[30%]"
        style={{ backgroundColor: palette.side, borderRight: `1px solid ${palette.line}` }}
      >
        <span
          className="mx-[14%] mt-[20%] block h-[4.5px] w-[72%] rounded-full"
          style={{ backgroundColor: palette.ink, opacity: 0.8 }}
        />
        <span
          className="mx-[14%] mt-[11%] block h-[3.5px] w-[54%] rounded-full"
          style={{ backgroundColor: palette.muted }}
        />
        <span
          className="mx-[14%] mt-[7%] block h-[3.5px] w-[64%] rounded-full"
          style={{ backgroundColor: palette.muted }}
        />
        <span
          className="mx-[14%] mt-[7%] block h-[3.5px] w-[46%] rounded-full"
          style={{ backgroundColor: palette.muted }}
        />
      </span>
      <span
        className="absolute inset-y-[9%] right-[5%] left-[38%] block rounded-[5px]"
        style={{ backgroundColor: palette.panel, border: `1px solid ${palette.line}` }}
      >
        <span
          className="mx-[9%] mt-[13%] block h-[5px] w-[46%] rounded-full"
          style={{ backgroundColor: palette.ink }}
        />
        <span
          className="mx-[9%] mt-[10%] block h-[3.5px] w-[82%] rounded-full"
          style={{ backgroundColor: palette.muted }}
        />
        <span
          className="mx-[9%] mt-[6%] block h-[3.5px] w-[64%] rounded-full"
          style={{ backgroundColor: palette.muted }}
        />
        <span
          className="mx-[9%] mt-[16%] block h-[7px] w-[30%] rounded-[3px]"
          style={{ backgroundColor: palette.accent }}
        />
      </span>
    </span>
  );
}
