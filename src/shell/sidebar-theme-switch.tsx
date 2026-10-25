'use client';

import { useSyncExternalStore } from 'react';
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { applyAppearancePrefs, getAppearanceSnapshot, resolveTheme, subscribeAppearance } from '@/lib/appearance';
import { useTranslation } from '@/lib/i18n';
import { messages } from './i18n/navigation-sidebar.messages';
import styles from './sidebar-footer.module.css';

export function SidebarThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation(messages);
  const theme = useSyncExternalStore(subscribeAppearance, () => resolveTheme(getAppearanceSnapshot().theme), () => 'light' as const);
  const label = t(theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
  return <Tooltip>
    <TooltipTrigger asChild><AnimatedThemeToggler className={styles.iconButton} theme={theme} aria-label={label} onThemeChange={next => applyAppearancePrefs({ ...getAppearanceSnapshot(), theme: next })} /></TooltipTrigger>
    <TooltipContent side={compact ? 'right' : 'top'}>{label}</TooltipContent>
  </Tooltip>;
}
