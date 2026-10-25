'use client';

import { ArrowUpRight, Coffee } from '@/components/icons';
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
  if (rewards.identityStatus === 'checking' || (authenticated && rewards.loading && !summary) || summary?.checkedInToday) return null;
  return <section className={`${resourceCard.card} ${styles.sidebarCard}`} aria-label={t('daily')}>
    <div className={styles.cardHeading}>
      <Coffee size={16} className={styles.coffeeIcon} aria-hidden />
      <div className={styles.cardCopy}>
        <strong>{t('daily')}</strong>
        <p className={styles.cardDescription}>{t('dailyReward')}</p>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" className={styles.cardOpen} aria-label={t('open')} onClick={onOpen}>
        <ArrowUpRight size={14} aria-hidden />
      </Button>
    </div>
    {authenticated && !summary ? <p className={styles.cardStatus}>{t(rewards.error ? 'unavailable' : 'loading')}</p> : null}
    <Button type="button" size="sm" className={styles.cardCta}
      loading={rewards.checkingIn} disabled={rewards.loading}
      onClick={() => { if (!authenticated) rewards.openSignIn(); else if (rewards.error && !summary) rewards.refresh(); else void rewards.checkIn(); }}>
      {t(!authenticated ? 'signIn' : rewards.error && !summary ? 'retry' : 'checkIn')}
    </Button>
  </section>;
}
