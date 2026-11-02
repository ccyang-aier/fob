'use client';

import type { ProfileActivityCounts } from '@fob/shared/knowledge/contracts';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { useTranslation } from '@/lib/i18n';
import { profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import { activityKinds } from './activity-kinds';
import { messages } from './messages';
import styles from './activity-calendar.module.css';

const emptyCounts: ProfileActivityCounts = { created: 0, commented: 0, liked: 0, subscribed: 0 };

export function ActivityDayDetails({ anchor, date, counts = emptyCounts, onClose }: {
  anchor: HTMLElement;
  date: string;
  counts?: ProfileActivityCounts;
  onClose: () => void;
}) {
  const { t, locale } = useTranslation(messages);
  const dateLabel = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));

  return (
    <AnchoredPopover anchor={anchor} onClose={onClose} align="end" width={244} label={t('activityDetails', { date: dateLabel })}>
      <div className={styles.dayDetails}>
        <div className={styles.dayDetailsHeading}><strong>{dateLabel}</strong></div>
        <dl className={styles.dayDetailsCounts}>
          {(['created','commented','liked','subscribed'] as const).map(kind => {
            const { Icon, label } = activityKinds[kind];
            return <div key={kind} data-kind={kind}><dt><span className={styles.dayDetailsIcon}><Icon size={16} aria-hidden /></span>{t(label)}</dt><dd>{counts[kind]}</dd></div>;
          })}
        </dl>
      </div>
    </AnchoredPopover>
  );
}
