'use client';

import { ArrowUpRight, Check, Coffee } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import resourceCard from '@/components/ui/resource-card.module.css';
import { useTranslation } from '@/lib/i18n/react';
import { useCoffeeRewards } from './rewards-provider';
import { openRewardsPage } from './coffee-balance-button';
import { rewardsMessages } from './rewards.messages';
import styles from './rewards.module.css';

export function RewardsCard({ onOpen = openRewardsPage }: { onOpen?: () => void }) {
  const { t } = useTranslation(rewardsMessages);
  const rewards = useCoffeeRewards();
  const authenticated = rewards.identityStatus === 'authenticated';
  const summary = rewards.summary;
  return <section className={`${resourceCard.card} ${styles.sidebarCard}`} aria-label={t('daily')}>
    <div className={styles.cardHeading}>
      <Coffee size={18} weight="fill" className={styles.coffeeIcon} aria-hidden />
      <strong>{t('daily')}</strong>
      <Button type="button" variant="ghost" size="icon-sm" className={styles.cardOpen} aria-label={t('open')} onClick={onOpen}>
        <ArrowUpRight size={14} aria-hidden />
      </Button>
    </div>
    <p className={styles.cardDescription}>{t('dailyReward')}</p>
    {summary ? <>
      <div className={styles.progress} role="progressbar" aria-label={t('calendar')} aria-valuenow={summary.month.checkIns} aria-valuemin={0} aria-valuemax={summary.month.days}>
        <span style={{ width: `${summary.month.checkIns / summary.month.days * 100}%` }} />
      </div>
      <div className={styles.monthCaption}><span>{t('monthProgress', { count: summary.month.checkIns })}</span><span>{summary.month.checkIns}/{summary.month.days}</span></div>
    </> : authenticated ? <p className={styles.cardStatus}>{t(rewards.error ? 'unavailable' : 'loading')}</p> : null}
    <Button type="button" size="sm" variant={summary?.checkedInToday ? 'outline' : 'default'} className={styles.cardCta}
      loading={rewards.checkingIn} disabled={rewards.identityStatus === 'checking' || rewards.loading || summary?.checkedInToday}
      onClick={() => { if (!authenticated) rewards.openSignIn(); else if (rewards.error && !summary) rewards.refresh(); else void rewards.checkIn(); }}>
      {summary?.checkedInToday ? <Check weight="bold" size={13} aria-hidden /> : null}
      {t(!authenticated ? 'signIn' : rewards.error && !summary ? 'retry' : summary?.checkedInToday ? 'checkedIn' : 'checkIn')}
    </Button>
  </section>;
}
