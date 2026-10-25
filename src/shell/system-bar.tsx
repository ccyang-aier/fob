'use client';

import { ArrowLeft, ArrowRight } from '@/components/icons';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { KnowledgeNotificationBell } from '@/features/knowledge/notifications/components/notification-bell';
import { AccountItem } from '@/features/identity/components/account-item';
import { CoffeeBalanceButton } from '@/features/rewards';
import { useTranslation } from '@/lib/i18n';
import { GlobalSearch } from './global-search';
import { ThemeSwitch } from './theme-switch';
import type { useWorkbenchView, WorkbenchView } from './workbench-view';
import { messages } from './i18n/system-bar.messages';
import styles from './system-bar.module.css';

export function SystemBar({ onNavigate, navigation, children }: {
  onNavigate: (view: WorkbenchView) => void;
  navigation: ReturnType<typeof useWorkbenchView>[3];
  children: ReactNode;
}) {
  const { t } = useTranslation(messages);
  return <header className={styles.bar}>
    <nav aria-label={t('页面历史')} className={styles.actions}>
      <Tooltip><TooltipTrigger asChild><button type="button" className={`fob-action ${styles.button}`} aria-label={t('后退')} disabled={!navigation.canGoBack} onClick={navigation.goBack}><ArrowLeft size={16} aria-hidden /></button></TooltipTrigger><TooltipContent side="bottom">{t('后退')}</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><button type="button" className={`fob-action ${styles.button}`} aria-label={t('前进')} disabled={!navigation.canGoForward} onClick={navigation.goForward}><ArrowRight size={16} aria-hidden /></button></TooltipTrigger><TooltipContent side="bottom">{t('前进')}</TooltipContent></Tooltip>
    </nav>
    {children}
    <div className={`${styles.actions} ${styles.trailing}`}>
      <GlobalSearch className={styles.button} onNavigate={onNavigate} />
      <ThemeSwitch className={styles.button} />
      <KnowledgeNotificationBell onOpenWorkbench={() => onNavigate('knowledge')} />
      <CoffeeBalanceButton onOpen={() => onNavigate('rewards')} />
      <span className={styles.separator} aria-hidden />
      <AccountItem variant="topbar" />
    </div>
  </header>;
}
