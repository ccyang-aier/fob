'use client';

import { Coffee } from '@phosphor-icons/react';
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
      <button type="button" className={`fob-action ${styles.balanceButton}`} aria-label={label}
        disabled={rewards.identityStatus === 'checking'} onClick={authenticated ? onOpen : rewards.openSignIn}>
        <Coffee size={18} weight="fill" aria-hidden />
        {authenticated && rewards.summary ? <span className={styles.balanceNumber} aria-hidden>{rewards.summary.balance > 99 ? '99+' : rewards.summary.balance}</span> : null}
      </button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>;
}
