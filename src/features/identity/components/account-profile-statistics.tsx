'use client';

import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCoffeeRewards } from '@/features/rewards/rewards-provider';
import { useTranslation } from '@/lib/i18n';
import { messages } from '../profile/messages';
import styles from './account-profile.module.css';

export function AccountProfileStatistics({ data }: { data?: PersonalProfile }) {
  const { t } = useTranslation(messages);
  const coffee = useCoffeeRewards();
  const stats = [
    { label: t('documents'), value: data?.documentTotal, hint: t('documentsHint') },
    { label: t('coffee'), value: coffee.summary?.balance, hint: t(coffee.error ? 'coffeeUnavailable' : 'coffeeHint') },
    { label: t('likes'), value: data?.receivedLikesTotal, hint: t('likesHint') },
  ];
  return <dl className={styles.statistics}>{stats.map(stat => <Tooltip key={stat.label}><TooltipTrigger asChild><div className={styles.statistic} tabIndex={0}><dt>{stat.label}</dt><dd>{stat.value?.toLocaleString() ?? '—'}</dd></div></TooltipTrigger><TooltipContent>{stat.hint}</TooltipContent></Tooltip>)}</dl>;
}
