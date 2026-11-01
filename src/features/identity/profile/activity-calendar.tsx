'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { calendarDays, profileDay, profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import { messages } from './messages';
import { ActivityDayDetails } from './activity-day-details';
import styles from './activity-calendar.module.css';

export function ActivityCalendar({ calendar, scope }: { calendar: PersonalProfile['calendar']; scope?: string }) {
  const { t, locale } = useTranslation(messages);
  const scroll = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<{ date: string; anchor: HTMLButtonElement } | null>(null);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { element.scrollLeft = element.scrollWidth; });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const id = useId(), today = profileDay(new Date());
  const records = new Map(calendar.map(day => [day.date, day]));
  const days = calendarDays(today, new Map(calendar.map(day => [day.date, day.count])), 6);
  const total = days.reduce((sum,day) => sum+day.count, 0);
  const monthFormat = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'short' });
  const dateFormat = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'long', day: 'numeric' });
  const weeks = Array.from({ length: days.length/7 }, (_,index) => days.slice(index*7,index*7+7));
  return <section className={styles.calendarCard} aria-labelledby={id} style={{ '--activity-columns': weeks.length } as CSSProperties}>
    <div className={styles.calendarHeading}>
      <h3 id={id}>{t('halfYear')}<span className={styles.middleDot}>·</span><span>{t('activities', { count: total })}</span></h3>
      {scope ? <span className={styles.scope} title={scope}>{scope}</span> : null}
    </div>
    <div ref={scroll} className={styles.calendarScroll}><div className={styles.calendarLayout}>
      <div className={styles.weekLabels} aria-hidden><span>{t('mon')}</span><span>{t('wed')}</span><span>{t('fri')}</span></div>
      <div className={styles.weeks} role="group" aria-label={t('heatmap')}>
        {weeks.map((week,index) => {
          const monthDay = week.find(day => day.date.slice(-2) === '01' && !day.outside && !day.future);
          const firstDay = week.find(day => !day.outside && !day.future)?.date ?? week[0].date;
          return <div className={styles.week} key={week[0].date}><span className={styles.month}>{index === 0 || monthDay ? monthFormat.format(new Date(`${monthDay?.date ?? firstDay}T12:00:00Z`)) : ''}</span>
            {week.map((day,row) => day.future || day.outside ? <span key={day.date} className={styles.dayCell} data-future /> : <Tooltip key={day.date}><TooltipTrigger asChild><button type="button" data-calendar-index={index*7+row} className={styles.dayCell} data-level={Math.min(4,day.count)} data-today={today === day.date} aria-label={t('activityOnDay', { date: dateFormat.format(new Date(`${day.date}T12:00:00Z`)), count: day.count })} aria-haspopup="dialog" aria-expanded={detail?.date === day.date} tabIndex={(detail?.date ?? today) === day.date ? 0 : -1} onClick={event => { const anchor = event.currentTarget; setDetail(current => current?.date === day.date ? null : { date: day.date, anchor }); }} onKeyDown={event => {
              if (event.ctrlKey || event.metaKey || event.altKey) return;
              const movement: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1, Home: -row, End: 6-row };
              if (event.key in movement) { event.preventDefault(); const next = Math.max(days.findIndex(day => !day.outside), Math.min(days.findLastIndex(day => !day.future), index*7+row+movement[event.key])); event.currentTarget.closest('[role="group"]')?.querySelector<HTMLButtonElement>(`[data-calendar-index="${next}"]`)?.focus(); }
            }} /></TooltipTrigger><TooltipContent>{t('activityOnDay', { date: dateFormat.format(new Date(`${day.date}T12:00:00Z`)), count: day.count })}</TooltipContent></Tooltip>)}
          </div>;
        })}
      </div>
    </div></div>
    <div className={styles.legend} aria-hidden><span>{t('less')}</span>{[0,1,2,3,4].map(level => <span key={level} className={styles.dayCell} data-level={level} />)}<span>{t('moreActivity')}</span></div>
    {detail ? <ActivityDayDetails anchor={detail.anchor} date={detail.date} total={records.get(detail.date)?.count ?? 0} counts={records.get(detail.date)?.counts} onClose={() => setDetail(null)} /> : null}
  </section>;
}
