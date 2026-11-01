'use client';

import type { ProfileActivity } from '@fob/shared/knowledge/contracts';
import { DotsThree, FileText, Folder } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import resourceCard from '@/components/ui/resource-card.module.css';
import { useTranslation } from '@/lib/i18n';
import type { ProfileResourceActions } from './profile-resources';
import { messages } from './messages';
import { activityKinds } from './activity-kinds';
import styles from './profile.module.css';

type ActivityEventProps = {
  event: ProfileActivity;
  author: string;
  time: string;
  onOpen: ProfileResourceActions['onOpen'];
};

export function ActivityEvent({ event, author, time, onOpen }: ActivityEventProps) {
  const { t } = useTranslation(messages);
  const { Icon } = activityKinds[event.kind];
  const ResourceIcon = event.targetKind === 'folder' ? Folder : FileText;
  const open = () => onOpen({ id: event.targetId, kind: event.targetKind });

  return (
    <li className={styles.event} data-kind={event.kind}>
      <span className={styles.timelineDot} aria-hidden />
      <time className={styles.eventTime} dateTime={event.at}>{time}</time>
      <article className={styles.eventBody}>
        <div className={styles.eventHeader}>
          <div className={styles.eventSummary}>
            <span className={styles.eventKind}><span className={styles.eventIcon}><Icon size={16} aria-hidden /></span><span className={styles.eventVerb}>{t(event.kind)}</span></span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className={styles.eventActions} aria-label={t('resourceActions', { title: event.title })}>
                <DotsThree size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={open}><ResourceIcon size={16} />{t('open')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {event.kind === 'created' ? (
          <button type="button" className={`fob-action ${resourceCard.card} ${styles.documentAttachment}`} onClick={open} aria-label={t('openDocument', { title: event.title })}>
            <span className={styles.attachmentIcon}><FileText size={30} aria-hidden /></span>
            <span className={styles.attachmentContent}>
              <strong>{event.title}</strong>
              <span>{author}</span>
            </span>
          </button>
        ) : <div className={styles.eventContent}>
          <button type="button" className={`fob-action ${styles.eventTitle}`} data-variant="text" onClick={open}>{event.title}</button>
          {event.excerpt ? <blockquote className={styles.excerpt}>{event.excerpt}</blockquote> : null}
        </div>}
      </article>
    </li>
  );
}
