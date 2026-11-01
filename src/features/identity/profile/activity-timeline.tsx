'use client';

import type { ProfileActivity } from '@fob/shared/knowledge/contracts';
import { ArrowRight } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { useIdentity } from '../identity-context';
import { useTranslation } from '@/lib/i18n';
import { profileDay, profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import type { ProfileResourceActions } from './profile-resources';
import { ActivityEvent } from './activity-event';
import { messages } from './messages';
import styles from './profile.module.css';

type ActivityTimelineProps = {
  activities: ProfileActivity[];
  selected?: string;
  onClear: () => void;
  onOpen: ProfileResourceActions['onOpen'];
  nextOffset: number | null;
  onMore: () => void;
  loading: boolean;
};

export function ActivityTimeline({ activities, selected, onClear, onOpen, nextOffset, onMore, loading }: ActivityTimelineProps) {
  const { t, locale } = useTranslation(messages);
  const { session } = useIdentity();
  const name = session.status === 'authenticated' ? session.user.name : '';
  const today = profileDay(new Date());
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const yesterdayDay = yesterday.toISOString().slice(0,10);
  const dateFormat = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'long', day: 'numeric', weekday: 'short' });
  const timeFormat = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  const groups = new Map<string, ProfileActivity[]>();
  for (const activity of activities) {
    const day = profileDay(activity.at);
    const group = groups.get(day) ?? [];
    group.push(activity);
    groups.set(day,group);
  }

  return (
    <section className={styles.timeline} aria-label={t('activity')} aria-busy={loading}>
      {selected ? (
        <div className={styles.selectedDay}>
          <span>{t('selectedDate', { date: dateFormat.format(new Date(`${selected}T12:00:00Z`)) })}</span>
          <Button variant="ghost" size="sm" onClick={onClear}>{t('allActivity')}<ArrowRight size={15} /></Button>
        </div>
      ) : null}
      {activities.length ? [...groups].map(([date,events]) => (
        <section className={styles.dayGroup} key={date}>
          <h2 className={styles.dayHeading}>
            {date === today ? <>{t('today')}<span>·</span></> : date === yesterdayDay ? <>{t('yesterday')}<span>·</span></> : null}
            <time dateTime={date}>{dateFormat.format(new Date(`${date}T12:00:00Z`))}</time>
          </h2>
          <ol className={styles.events}>
            {events.map(event => <ActivityEvent key={event.id} event={event} author={name} time={timeFormat.format(new Date(event.at))} onOpen={onOpen} />)}
          </ol>
        </section>
      )) : loading ? (
        <div className={styles.loading} role="status"><span className={styles.loadingLine} /><span>{t('loading')}</span></div>
      ) : (
        <EmptyState
          className={styles.timelineEmpty}
          label={t(selected ? 'noActivity' : 'firstActivity')}
          description={t(selected ? 'noActivityHint' : 'firstActivityHint')}
          actions={selected ? <Button variant="outline" onClick={onClear}>{t('allActivity')}</Button> : undefined}
        />
      )}
      {nextOffset !== null ? (
        <div className={styles.loadMore}><Button variant="outline" loading={loading} onClick={onMore}>{t('moreEvents')}</Button></div>
      ) : null}
    </section>
  );
}
