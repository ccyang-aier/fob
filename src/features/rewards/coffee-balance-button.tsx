'use client';

import { Coffee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n/react';
import { pushWorkbenchLocation } from '@/lib/navigation-history';
import { useCoffeeRewards } from './rewards-provider';
import { rewardsMessages } from './rewards.messages';
import styles from './rewards.module.css';

export function openRewardsPage() {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'rewards');
  for (const key of ['document', 'comment', 'block', 'tab']) url.searchParams.delete(key);
  pushWorkbenchLocation(url);
}

export function CoffeeBalanceButton({ onOpen = openRewardsPage }: { onOpen?: () => void }) {
  const { t } = useTranslation(rewardsMessages);
  const rewards = useCoffeeRewards();
  const authenticated = rewards.identityStatus === 'authenticated';
  const label = authenticated && rewards.summary ? t('balanceLabel', { count: rewards.summary.balance }) : t(authenticated ? 'open' : 'signIn');
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="sm" className={styles.balanceButton} aria-label={label}
        disabled={rewards.identityStatus === 'checking'} onClick={authenticated ? onOpen : rewards.openSignIn}>
        <Coffee size={17} strokeWidth={1.8} className={styles.coffeeIcon} aria-hidden />
        <span className={styles.balanceNumber}>{authenticated ? rewards.summary ? rewards.summary.balance : '—' : t('signIn')}</span>
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>;
}
