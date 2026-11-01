'use client';

import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { FileText, CommentOutline, ThumbsUp } from '@/components/icons';
import resourceCard from '@/components/ui/resource-card.module.css';
import { useTranslation } from '@/lib/i18n';
import { profileDay, profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import { ProfileHonors } from './profile-honors';
import { messages } from './messages';
import styles from './profile.module.css';

export function ProfileSidebar({ data, selected, changing }: { data: PersonalProfile; selected?: string; changing?: boolean }) {
  const { t, locale } = useTranslation(messages);
  const day = selected ?? profileDay(new Date());
  const date = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(day + 'T12:00:00Z'));
  const summary = [
    { key: 'created' as const, Icon: FileText, count: data.dayCounts.created },
    { key: 'postedComment' as const, Icon: CommentOutline, count: data.dayCounts.commented },
    { key: 'receivedLikes' as const, Icon: ThumbsUp, count: data.receivedLikes },
  ];

  return (
    <aside className={styles.sidebar}>
      <section className={resourceCard.card + ' ' + styles.dailySummary} aria-busy={changing} aria-label={t('day')}>
        <div className={styles.sectionHeading}><h2>{t('day')}</h2><time dateTime={day}>{date}</time></div>
        <dl>{summary.map(({ key, Icon, count }) => <div key={key}><dt><Icon size={20} aria-hidden /><span>{t(key)}</span></dt><dd>{changing ? '—' : count}</dd></div>)}</dl>
      </section>
      <ProfileHonors data={data} />
    </aside>
  );
}
