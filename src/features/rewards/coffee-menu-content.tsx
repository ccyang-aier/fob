'use client';

import { CalendarBlank, Check, Coffee, Ticket } from '@/components/icons';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/react';
import type { useCoffeeRewards } from './rewards-provider';
import { rewardsMessages } from './rewards.messages';
import styles from './rewards.module.css';

export function CoffeeMenuContent({ rewards, onSignIn }: { rewards: ReturnType<typeof useCoffeeRewards>; onSignIn(): void }) {
  const { t } = useTranslation(rewardsMessages);
  const authenticated = rewards.identityStatus === 'authenticated';
  const summary = rewards.summary;
  return <>
    <div className={styles.menuBalance} aria-live="polite">
      <span><Coffee size={16} aria-hidden />{t('balance')}</span>
      {summary ? <strong>{summary.balance}<small>{t('cups')}</small></strong> : <span className={styles.menuStatus}>{t(!authenticated ? 'signInToView' : rewards.error ? 'balanceUnavailable' : 'loading')}</span>}
    </div>
    <div className={styles.menuRow}>
      <CalendarBlank size={16} aria-hidden />
      <div className={styles.menuCopy}><span>{t('daily')}</span><small>{summary ? t('streak', { count: summary.currentStreak }) : t('dailyReward')}</small></div>
      <Button size="sm" variant="outline" className={styles.menuCheckIn} loading={rewards.checkingIn} disabled={authenticated && (!summary || summary.checkedInToday)} onClick={() => { if (!authenticated) onSignIn(); else void rewards.checkIn(); }}>
        {summary?.checkedInToday && <Check size={14} aria-hidden />}{t(!authenticated ? 'signIn' : summary?.checkedInToday ? 'checkedIn' : 'checkIn')}
      </Button>
    </div>
    <div className={styles.menuRow}>
      <Ticket size={16} aria-hidden /><span className={styles.menuCopy}>{t('vouchers')}</span><span className={styles.menuStatus}>{t('vouchersUnavailable')}</span>
    </div>
    {authenticated && rewards.error ? <AppAlert tone="error" title={t('unavailable')} action={<Button size="sm" variant="outline" onClick={rewards.refresh}>{t('retry')}</Button>} /> : null}
  </>;
}
