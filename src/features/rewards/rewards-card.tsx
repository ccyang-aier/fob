'use client';

import { ArrowUpRight, Check, Coffee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n/react';
import { useCoffeeRewards } from './rewards-provider';
import { openRewardsPage } from './coffee-balance-button';
import { rewardsMessages } from './rewards.messages';
import styles from './rewards.module.css';

export function RewardsCard({ compact = false, onOpen = openRewardsPage }: { compact?: boolean; onOpen?: () => void }) {
  const { t } = useTranslation(rewardsMessages);
  const rewards = useCoffeeRewards();
  const authenticated = rewards.identityStatus === 'authenticated';
  const summary = rewards.summary;
  if (compact) return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon-sm" className={styles.compactCard} aria-label={t('title')}
        onClick={authenticated ? onOpen : rewards.openSignIn}>
        <Coffee size={20} strokeWidth={1.8} className={styles.coffeeIcon} aria-hidden />
        {summary?.checkedInToday ? <i className={styles.collectedDot} aria-hidden /> : null}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="right">{t(summary?.checkedInToday ? 'checkedIn' : 'daily')}</TooltipContent>
  </Tooltip>;
  return <section className={styles.sidebarCard} aria-label={t('daily')}>
    <div className={styles.cardHeading}>
      <span className={styles.coffeeBadge}><Coffee size={20} strokeWidth={1.7} aria-hidden /></span>
      <div><strong>{t('daily')}</strong><p>{t('dailyReward')}</p></div>
      <Button type="button" variant="ghost" size="icon-sm" className={styles.cardOpen} aria-label={t('open')} onClick={onOpen}>
        <ArrowUpRight size={14} aria-hidden />
      </Button>
    </div>
    {summary ? <>
      <div className={styles.monthCaption}><span>{t('monthProgress', { count: summary.month.checkIns })}</span><span>{summary.month.checkIns}/{summary.month.days}</span></div>
      <div className={styles.progress} role="progressbar" aria-label={t('calendar')} aria-valuenow={summary.month.checkIns} aria-valuemin={0} aria-valuemax={summary.month.days}>
        <span style={{ width: `${summary.month.checkIns / summary.month.days * 100}%` }} />
      </div>
    </> : authenticated ? <p className={styles.cardStatus}>{t(rewards.error ? 'unavailable' : 'loading')}</p> : null}
    <Button type="button" size="sm" variant={summary?.checkedInToday ? 'outline' : 'default'} className={styles.cardCta}
      loading={rewards.checkingIn} disabled={rewards.identityStatus === 'checking' || rewards.loading || summary?.checkedInToday}
      onClick={() => { if (!authenticated) rewards.openSignIn(); else if (rewards.error && !summary) rewards.refresh(); else void rewards.checkIn(); }}>
      {summary?.checkedInToday ? <Check size={13} aria-hidden /> : null}
      {t(!authenticated ? 'signIn' : rewards.error && !summary ? 'retry' : summary?.checkedInToday ? 'checkedIn' : 'checkIn')}
    </Button>
  </section>;
}
