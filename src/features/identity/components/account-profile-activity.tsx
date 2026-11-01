'use client';

import { useId } from 'react';
import { Emoji } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { activityStreak, profileDay } from '@/features/knowledge/profile/profile-calendar';
import { usePersonalProfileSummary } from '@/features/knowledge/profile/use-personal-profile';
import { ActivityCalendar } from '../profile/activity-calendar';
import { messages } from '../profile/messages';
import styles from './account-profile.module.css';

export function AccountProfileActivity() {
  const { t } = useTranslation(messages);
  const profile = usePersonalProfileSummary();
  const heading = useId();
  if (!profile.base) return <p className={styles.emptyMedals}>{t('chooseBase')}</p>;
  if (profile.loading) return <div className={styles.loadState} role="status">{t('loading')}</div>;
  if (profile.error) return <div className={styles.loadState}><AppAlert tone="error" title={t('loadFailed')} />{profile.base.source === 'server' ? <Button variant="outline" size="sm" onClick={() => void profile.retry()}>{t('retry')}</Button> : null}</div>;
  if (!profile.data) return null;
  const data = profile.data;
  const streak = activityStreak(data.calendar, profileDay(new Date()));
  const honors = [
    { key: 'gardener', emoji: '🏅', title: t('gardener'), hint: t('gardenerHint', { count: data.documentTotal }), earned: data.documentTotal > 0 },
    { key: 'creator', emoji: '🔥', title: t('creator'), hint: t('creatorHint', { count: streak }), earned: streak >= 7 },
    { key: 'sharing', emoji: '🏅', title: t('sharing'), hint: t('sharingHint', { count: data.sharedDocuments }), earned: data.sharedDocuments > 0 },
  ].filter(honor => honor.earned);
  return <div className={styles.activity}>
    <ActivityCalendar calendar={data.calendar} scope={profile.base.name} />
    <section className={styles.medals} aria-labelledby={heading}><h3 id={heading}>{t('earnedMedals')}</h3>
      {honors.length ? <div className={styles.medalList}>{honors.map(honor => <Tooltip key={honor.key}><TooltipTrigger asChild><span className={styles.medal} tabIndex={0}><Emoji value={honor.emoji} size={24} /><span>{honor.title}</span></span></TooltipTrigger><TooltipContent>{honor.hint}</TooltipContent></Tooltip>)}</div> : <p className={styles.emptyMedals}>{t('noMedals')}</p>}
    </section>
  </div>;
}
