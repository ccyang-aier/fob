'use client';

import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { BookOpen, Clock, Coffee, ThumbsUp } from '@/components/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { messages } from '../profile/messages';
import styles from './account-profile.module.css';

export function AccountProfileStatistics({ data }: { data?: PersonalProfile }) {
  const { t } = useTranslation(messages);
  const stats = [
    { key: 'documents', Icon: BookOpen, label: t('documents'), value: data?.documentTotal, hint: t('documentsHint') },
    { key: 'coffee', Icon: Coffee, label: t('coffee'), value: data?.receivedCoffeeTotal, hint: t('coffeeHint') },
    { key: 'likes', Icon: ThumbsUp, label: t('likes'), value: data?.receivedLikesTotal, hint: t('likesHint') },
    { key: 'learning', Icon: Clock, label: t('learning'), value: data?.learningMinutes, unit: t('minutes'), hint: t('learningHint') },
  ];
  return <dl className={styles.statistics}>{stats.map(({ Icon, ...stat }) => <Tooltip key={stat.key}><TooltipTrigger asChild><div className={styles.statistic} data-stat={stat.key} tabIndex={0}><dt><Icon size={22} aria-hidden /><span>{stat.label}</span></dt><dd>{stat.value?.toLocaleString() ?? '—'}{stat.unit ? <span>{stat.unit}</span> : null}</dd></div></TooltipTrigger><TooltipContent>{stat.hint}</TooltipContent></Tooltip>)}</dl>;
}
