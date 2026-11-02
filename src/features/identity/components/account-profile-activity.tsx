'use client';

import { useId, useState } from 'react';
import type { ProfileMedalId } from '@fob/shared/knowledge/contracts';
import { CaretRight } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { usePersonalProfileSummary } from '@/features/knowledge/profile/use-personal-profile';
import { ActivityCalendar } from '../profile/activity-calendar';
import { MedalArt,medalById,medalRules } from '../profile/medal-art';
import { MedalWall } from '../profile/medal-wall';
import { AccountProfileStatistics } from './account-profile-statistics';
import { messages } from '../profile/messages';
import styles from './account-profile.module.css';

export function AccountProfileActivity() {
  const { t } = useTranslation(messages);
  const profile = usePersonalProfileSummary();
  const heading = useId();
  const [wall,setWall] = useState<{ medal?: ProfileMedalId } | null>(null);
  if (!profile.base || profile.loading || profile.error) return <div className={styles.activity}><AccountProfileStatistics />{!profile.base ? <p className={styles.emptyMedals}>{t('chooseBase')}</p> : profile.loading ? <div className={styles.loadState} role="status">{t('loading')}</div> : <div className={styles.loadState}><AppAlert tone="error" title={t('loadFailed')} />{profile.base.source === 'server' ? <Button variant="outline" size="sm" onClick={() => void profile.retry()}>{t('retry')}</Button> : null}</div>}</div>;
  if (!profile.data) return null;
  const data = profile.data;
  return <div className={styles.activity}>
    <AccountProfileStatistics data={data} />
    <ActivityCalendar calendar={data.calendar} scope={profile.base.name} />
    <section className={styles.medals} aria-labelledby={heading}>
      <div className={styles.medalHeading}><h3 id={heading}>{t('earnedMedals')}</h3><Button type="button" variant="ghost" size="sm" onClick={() => setWall({})}>{t('more')}<CaretRight size={12} aria-hidden /></Button></div>
      {data.medals.length ? <div className={styles.medalList}>{data.medals.slice(-6).reverse().map(award => <Tooltip key={award.id}><TooltipTrigger asChild><button type="button" className={`fob-action ${styles.medal}`} data-surface="plain" onClick={() => setWall({ medal: award.id })}><MedalArt id={award.id} small /><span>{t(award.id)}</span></button></TooltipTrigger><TooltipContent>{t(medalRules[medalById[award.id].family],{ count:medalById[award.id].target })}</TooltipContent></Tooltip>)}</div> : <p className={styles.emptyMedals}>{t('noMedals')}</p>}
    </section>
    {wall ? <MedalWall awards={data.medals} progress={data.medalProgress} initialMedal={wall.medal} onClose={() => setWall(null)} /> : null}
  </div>;
}
