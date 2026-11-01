'use client';

import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { FileText, CommentOutline, ThumbsUp } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { profileDay, profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import { ResourcePreview, type ProfileResourceActions } from './profile-resources';
import type { ProfileSection } from './personal-profile-page';
import { messages } from './messages';
import styles from './profile.module.css';

export function ProfileSidebar({ data, selected, onSection, changing, ...actions }: ProfileResourceActions & { data: PersonalProfile; selected?: string; changing?: boolean; onSection: (section: ProfileSection) => void }) {
  const { t, locale } = useTranslation(messages);
  const day = selected ?? profileDay(new Date());
  const date = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${day}T12:00:00Z`));
  const summary = [
    { key: 'created' as const, Icon: FileText, count: data.dayCounts.created },
    { key: 'postedComment' as const, Icon: CommentOutline, count: data.dayCounts.commented },
    { key: 'receivedLikes' as const, Icon: ThumbsUp, count: data.receivedLikes },
  ];
  return <aside className={styles.sidebar}>
    <section className={styles.dailySummary} aria-busy={changing}><div className={styles.sectionHeading}><h2>{t('day')}</h2><time dateTime={day}>{date}</time></div><dl>{summary.map(({ key, Icon, count }) => <div key={key}><dt><Icon size={25} aria-hidden /><span>{t(key)}</span></dt><dd>{changing ? '—' : count}</dd></div>)}</dl></section>
    <ResourcePreview title={t('myDocuments')} resources={data.documents} limit={2} onMore={() => onSection('documents')} {...actions} />
    <ResourcePreview title={t('myFolders')} resources={data.folders} limit={3} onMore={() => onSection('folders')} {...actions} />
    <ResourcePreview title={t('savedAndFollowed')} resources={data.saved} limit={2} onMore={() => onSection('saved')} {...actions} />
  </aside>;
}
