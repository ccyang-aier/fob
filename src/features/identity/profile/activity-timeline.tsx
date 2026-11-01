'use client';

import type { ProfileActivity } from '@fob/shared/knowledge/contracts';
import { FileText, CommentOutline, ThumbsUp, BellSimple, DotsThree, ArrowRight } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useIdentity } from '../identity-context';
import { useTranslation } from '@/lib/i18n';
import { profileDay, profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import type { ProfileResourceActions } from './profile-resources';
import { messages } from './messages';
import styles from './profile.module.css';

const activityIcons = { created: FileText, commented: CommentOutline, liked: ThumbsUp, subscribed: BellSimple };

export function ActivityTimeline({ activities, selected, onClear, onOpen, nextOffset, onMore, loading }: { activities: ProfileActivity[]; selected?: string; onClear: () => void; onOpen: ProfileResourceActions['onOpen']; nextOffset: number | null; onMore: () => void; loading: boolean }) {
  const { t, locale } = useTranslation(messages);
  const { session } = useIdentity();
  const name = session.status === 'authenticated' ? session.user.name : '';
  const today = profileDay(new Date());
  const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const yesterdayDay = yesterday.toISOString().slice(0,10);
  const dateFormat = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'long', day: 'numeric', weekday: 'short' });
  const timeFormat = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  const groups = new Map<string, ProfileActivity[]>();
  for (const activity of activities) { const day = profileDay(activity.at); const group = groups.get(day) ?? []; group.push(activity); groups.set(day,group); }
  return <section className={styles.timeline} aria-label={t('activity')} aria-busy={loading}>
    {selected ? <div className={styles.selectedDay}><span>{t('selectedDate', { date: dateFormat.format(new Date(`${selected}T12:00:00Z`)) })}</span><Button variant="ghost" size="sm" onClick={onClear}>{t('allActivity')}<ArrowRight size={15} /></Button></div> : null}
    {!activities.length ? loading ? <div className={styles.loading} role="status"><span className={styles.loadingLine} /><span>{t('loading')}</span></div> : <EmptyState className={styles.timelineEmpty} label={t(selected ? 'noActivity' : 'firstActivity')} description={t(selected ? 'noActivityHint' : 'firstActivityHint')} actions={selected ? <Button variant="outline" onClick={onClear}>{t('allActivity')}</Button> : undefined} /> : [...groups].map(([date,events]) => <section className={styles.dayGroup} key={date}>
      <h2 className={styles.dayHeading}>{date === today ? <>{t('today')}<span>·</span></> : date === yesterdayDay ? <>{t('yesterday')}<span>·</span></> : null}<time dateTime={date}>{dateFormat.format(new Date(`${date}T12:00:00Z`))}</time></h2>
      <ol className={styles.events}>{events.map(event => { const Icon = activityIcons[event.kind]; return <li className={styles.event} key={event.id}>
        <span className={styles.timelineDot} aria-hidden /><time className={styles.eventTime} dateTime={event.at}>{timeFormat.format(new Date(event.at))}</time><span className={styles.eventIcon} data-kind={event.kind}><Icon size={24} aria-hidden /></span><span className={styles.eventVerb}>{t(event.kind)}</span>
        <div className={styles.eventContent}><button type="button" className={`fob-action ${styles.eventTitle}`} onClick={() => onOpen({ id: event.targetId, kind: event.targetKind })}>{event.title}</button>
          {event.kind === 'created' ? <button type="button" className={`fob-action ${styles.documentAttachment}`} onClick={() => onOpen({ id: event.targetId, kind: 'document' })}><span className={styles.attachmentIcon}><FileText size={28} aria-hidden /></span><span><strong>{event.title}</strong><small>{name} · {new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'long', day: 'numeric' }).format(new Date(event.at))}</small></span></button> : event.excerpt ? <><blockquote className={styles.excerpt}>{event.excerpt}</blockquote><p className={styles.eventByline}>{name} · {new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'long', day: 'numeric' }).format(new Date(event.at))}</p></> : null}
        </div>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('resourceActions', { title: event.title })}><DotsThree size={18} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => onOpen({ id: event.targetId, kind: event.targetKind })}><Icon size={16} />{t('open')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </li>; })}</ol>
    </section>)}
    {nextOffset !== null ? <div className={styles.loadMore}><Button variant="outline" loading={loading} onClick={onMore}>{t('moreEvents')}</Button></div> : null}
  </section>;
}
