'use client';

import { useId } from 'react';
import type { PersonalProfile } from '@fob/shared/knowledge/contracts';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { calendarDays, profileDay, profileTimeZone } from '@/features/knowledge/profile/profile-calendar';
import { messages } from './messages';
import styles from './profile.module.css';

export function ActivityCalendar({ calendar, selected, onSelect }: { calendar: PersonalProfile['calendar']; selected?: string; onSelect: (date: string) => void }) {
  const { t, locale } = useTranslation(messages);
  const id = useId(), today = profileDay(new Date());
  const days = calendarDays(today, new Map(calendar.map(day => [day.date, day.count])));
  const total = calendar.reduce((sum,day) => sum+day.count, 0);
  const monthFormat = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'short' });
  const dateFormat = new Intl.DateTimeFormat(locale, { timeZone: profileTimeZone, month: 'long', day: 'numeric' });
  const weeks = Array.from({ length: days.length/7 }, (_,index) => days.slice(index*7,index*7+7));
  return <section className={styles.calendarCard} aria-labelledby={id}>
    <h2 id={id}>{t('sixMonths')}<span className={styles.middleDot}>·</span><span>{t('activities', { count: total })}</span></h2>
    <div className={styles.calendarScroll}><div className={styles.calendarLayout}>
      <div className={styles.weekLabels} aria-hidden><span>{t('mon')}</span><span>{t('wed')}</span><span>{t('fri')}</span></div>
      <div className={styles.weeks} role="group" aria-label={t('heatmap')}>
        {weeks.map((week,index) => {
          const monthDay = week.find(day => day.date.slice(-2) === '01');
          return <div className={styles.week} key={week[0].date}><span className={styles.month}>{index === 0 || monthDay ? monthFormat.format(new Date(`${monthDay?.date ?? week[0].date}T12:00:00Z`)) : ''}</span>
            {week.map((day,row) => day.future ? <span key={day.date} className={styles.dayCell} data-future /> : <Tooltip key={day.date}><TooltipTrigger asChild><button type="button" data-calendar-index={index*7+row} className={styles.dayCell} data-level={Math.min(4,day.count)} data-selected={selected === day.date} data-today={today === day.date} aria-label={t('activityOnDay', { date: dateFormat.format(new Date(`${day.date}T12:00:00Z`)), count: day.count })} aria-pressed={selected === day.date} tabIndex={(selected ?? today) === day.date ? 0 : -1} onClick={() => onSelect(day.date)} onKeyDown={event => {
              const movement: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1, Home: -row, End: 6-row };
              if (event.key in movement) { event.preventDefault(); const next = Math.max(0, Math.min(days.findLastIndex(day => !day.future), index*7+row+movement[event.key])); event.currentTarget.closest('[role="group"]')?.querySelector<HTMLButtonElement>(`[data-calendar-index="${next}"]`)?.focus(); }
            }} /></TooltipTrigger><TooltipContent>{t('activityOnDay', { date: dateFormat.format(new Date(`${day.date}T12:00:00Z`)), count: day.count })}</TooltipContent></Tooltip>)}
          </div>;
        })}
      </div>
    </div></div>
    <div className={styles.legend} aria-hidden><span>{t('less')}</span>{[0,1,2,3,4].map(level => <span key={level} className={styles.dayCell} data-level={level} />)}<span>{t('moreActivity')}</span></div>
  </section>;
}
