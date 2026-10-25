'use client';

import { CaretLeft, CaretRight } from '@/components/icons';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from '@/lib/i18n';
import { AnchoredPopover } from './anchored-popover';
import { Button } from './button';
import { dateKey, initialSelection, monthDays, monthStart, parseDay, pickerValue, shiftDay, withinBounds, type DatePickerType } from './date-picker-model';
import { messages } from './date-picker.messages';
import styles from './date-picker.module.css';

const halfHours = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);

export function DatePickerPanel({ id, anchor, value, type, min, max, step, onClose, onConfirm }: {
  id: string; anchor: HTMLElement; value: string; type: DatePickerType; min?: string; max?: string; step?: string | number;
  onClose: () => void; onConfirm: (value: string) => void;
}) {
  const { t, locale } = useTranslation(messages);
  const [selection, setSelection] = useState(() => initialSelection(value, min, max));
  const selectedDay = parseDay(selection.day)!;
  const [month, setMonth] = useState(() => monthStart(selectedDay));
  const [focusedDay, setFocusedDay] = useState(selection.day);
  const grid = useRef<HTMLDivElement>(null);
  const times = useRef<HTMLDivElement>(null);
  const draft = pickerValue(selection.day, selection.time, type);
  const valid = Boolean(selection.time) && withinBounds(draft, min, max);
  const days = monthDays(month);
  const today = dateKey(new Date());
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month);
  const dayLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'full' });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const timeLabel = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const secondLabel = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const summary = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(selectedDay);
  const options = halfHours.includes(selection.time) ? halfHours : [...halfHours, selection.time].filter(Boolean).sort();

  useLayoutEffect(() => {
    const list = times.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && selected) list.scrollTop = selected.offsetTop - list.offsetTop - 4 * selected.offsetHeight;
  }, []);

  function focusDate(date: Date) {
    const key = dateKey(date);
    if (!withinBounds(key, min?.slice(0, 10), max?.slice(0, 10))) return;
    setFocusedDay(key);
    setMonth(monthStart(date));
  }
  useLayoutEffect(() => { grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)?.focus({ preventScroll: true }); }, [focusedDay, month]);

  function navigateDay(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    let next: Date | undefined;
    if (offset) next = shiftDay(date, offset);
    if (event.key === 'Home') next = shiftDay(date, -(date.getDay() + 6) % 7);
    if (event.key === 'End') next = shiftDay(date, 6 - (date.getDay() + 6) % 7);
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const first = monthStart(date, event.key === 'PageUp' ? -1 : 1);
      next = shiftDay(first, Math.min(date.getDate(), shiftDay(monthStart(first, 1), -1).getDate()) - 1);
    }
    if (next) { event.preventDefault(); focusDate(next); }
  }

  return <AnchoredPopover anchor={anchor} label={t('chooseDateTime')} width={368}
    className={styles.popover} align="end" onClose={onClose}>
    <div id={id} className={styles.body}>
      <div className={styles.calendar}>
        <div className={styles.header}>
          <Button type="button" variant="outline" size="icon-sm" className={styles.monthButton} aria-label={t('previousMonth')}
            disabled={Boolean(min && dateKey(shiftDay(month, -1)) < min.slice(0, 10))} onClick={() => setMonth(monthStart(month, -1))}><CaretLeft size={14} /></Button>
          <span className={styles.heading} aria-live="polite">{monthLabel}</span>
          <Button type="button" variant="outline" size="icon-sm" className={styles.monthButton} aria-label={t('nextMonth')}
            disabled={Boolean(max && dateKey(monthStart(month, 1)) > max.slice(0, 10))} onClick={() => setMonth(monthStart(month, 1))}><CaretRight size={14} /></Button>
        </div>
        <div ref={grid} className={styles.grid} role="grid" aria-label={monthLabel}>
          <div className={styles.weekdays} role="row">{days.slice(0, 7).map(date => <span role="columnheader" key={dateKey(date)}>{weekday.format(date)}</span>)}</div>
          {Array.from({ length: 6 }, (_, week) => <div className={styles.week} role="row" key={week}>
            {days.slice(week * 7, week * 7 + 7).map(date => {
              const key = dateKey(date);
              const selected = key === selection.day;
              return <div role="gridcell" aria-selected={selected} key={key} className={styles.cell}>
                <button type="button" data-day={key} data-outside={date.getMonth() !== month.getMonth() || undefined} data-selected={selected || undefined}
                  data-today={key === today || undefined} data-autofocus={key === focusedDay || undefined} aria-label={dayLabel.format(date)} aria-current={key === today ? 'date' : undefined}
                  className={`fob-action ${styles.day}`} tabIndex={key === focusedDay ? 0 : -1}
                  disabled={!withinBounds(key, min?.slice(0, 10), max?.slice(0, 10))}
                  onKeyDown={event => navigateDay(event, date)} onClick={() => { setSelection(current => ({ ...current, day: key })); setFocusedDay(key); if (date.getMonth() !== month.getMonth()) setMonth(monthStart(date)); }}>{date.getDate()}</button>
              </div>;
            })}
          </div>)}
        </div>
      </div>
      <div className={styles.timeColumn}>
        <div ref={times} className={styles.times} role="listbox" aria-label={t('time')}>
          {options.map(time => <button key={time} type="button" role="option" aria-selected={selection.time === time} className={`fob-action ${styles.timeOption}`}
            tabIndex={selection.time === time ? 0 : -1} disabled={!withinBounds(pickerValue(selection.day, time, type), min, max)}
            onClick={() => setSelection(current => ({ ...current, time }))}
            onKeyDown={event => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
              const index = items.indexOf(event.currentTarget);
              items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
            }}>{(time.length > 5 ? secondLabel : timeLabel).format(new Date(`${selection.day}T${time}`))}</button>)}
        </div>
      </div>
    </div>
    <div className={styles.footer}>
      <Button type="button" variant="ghost" size="sm" className={styles.cancel} onClick={onClose}>{t('cancel')}</Button>
      <div className={styles.selection} aria-label={t('selectedDate')}>
        <span>{summary}</span>
        <input type="time" step={step ?? 60} required aria-label={t('exactTime')} value={selection.time}
          onChange={event => setSelection(current => ({ ...current, time: event.target.value }))} />
      </div>
      <Button type="button" variant="outline" size="sm" className={styles.confirm} disabled={!valid} onClick={() => onConfirm(draft)}>{t('confirm')}</Button>
    </div>
  </AnchoredPopover>;
}
