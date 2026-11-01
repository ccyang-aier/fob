'use client';

import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { Emoji, Trophy } from '@/components/icons';
import resourceCard from '@/components/ui/resource-card.module.css';
import { useTranslation } from '@/lib/i18n';
import { activityStreak, profileDay } from '@/features/knowledge/profile/profile-calendar';
import { messages } from './messages';
import styles from './profile.module.css';

export function ProfileHonors({ data }: { data: PersonalProfile }) {
  const { t } = useTranslation(messages);
  const streak = activityStreak(data.calendar, profileDay(new Date()));
  const badges = [
    { key: 'gardener', emoji: '🏅', title: t('gardener'), hint: t('gardenerHint', { count: data.documentTotal }), earned: data.documentTotal > 0 },
    { key: 'creator', emoji: '🔥', title: t('creator'), hint: t('creatorHint', { count: streak }), earned: streak >= 7 },
    { key: 'sharing', emoji: '🏅', title: t('sharing'), hint: t('sharingHint', { count: data.sharedDocuments }), earned: data.sharedDocuments > 0 },
  ];

  return (
    <section className={resourceCard.card + ' ' + styles.honorsCard} aria-label={t('honorsWall')}>
      <div className={styles.sectionHeading}>
        <h2><Trophy size={18} aria-hidden />{t('honorsWall')}</h2>
        <span className={styles.honorsCount}>{t('honorsEarned', { count: badges.filter(badge => badge.earned).length, total: badges.length })}</span>
      </div>
      <div className={styles.honorsList}>
        {badges.map(badge => (
          <div className={styles.honorItem} key={badge.key} data-earned={badge.earned}>
            <span className={styles.honorBadge}><Emoji value={badge.emoji} size={30} /></span>
            <div className={styles.honorContent}>
              <div><strong>{badge.title}</strong><span>{t(badge.earned ? 'earned' : 'locked')}</span></div>
              <p>{badge.hint}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
