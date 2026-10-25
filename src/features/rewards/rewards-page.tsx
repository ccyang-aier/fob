'use client';

import { Check, Coffee } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useTranslation } from '@/lib/i18n/react';
import { useCoffeeLedger, useCoffeeRewards } from './rewards-provider';
import { rewardsMessages } from './rewards.messages';
import styles from './rewards.module.css';

export function RewardsPage() {
  const { t, locale } = useTranslation(rewardsMessages);
  const rewards = useCoffeeRewards();
  const ledger = useCoffeeLedger();
  const summary = rewards.summary;
  const authenticated = rewards.identityStatus === 'authenticated';
  const monthStart = summary ? new Date(`${summary.month.month}-01T00:00:00.000Z`) : null;
  const checked = new Set(summary?.recentCheckIns);
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 5 + index))));
  const entries = ledger.data?.pages.flatMap(page => page.items) ?? [];
  return <div className={styles.page}>
    <header className={styles.pageHeading}><span className={styles.coffeeBadge}><Coffee size={22} weight="fill" aria-hidden /></span><h1>{t('title')}</h1></header>
    {!authenticated ? rewards.identityStatus === 'checking' ? <p className={styles.muted}>{t('checking')}</p> : <AppAlert tone="info" title={t('signInTitle')} description={t('signInDescription')}
      action={<Button size="sm" onClick={rewards.openSignIn}>{t('signIn')}</Button>} /> : null}
    {authenticated && rewards.error ? <AppAlert tone="error" title={t('unavailable')} action={<Button variant="outline" size="sm" onClick={rewards.refresh}>{t('retry')}</Button>} /> : null}
    {authenticated && rewards.loading ? <p className={styles.muted}>{t('loading')}</p> : null}
    {authenticated && summary ? <>
      <div className={styles.overview}>
        <section className={styles.balancePanel} aria-label={t('balance')}>
          <span className={styles.eyebrow}>{t('balance')}</span>
          <div className={styles.total}><Coffee size={34} weight="fill" className={styles.coffeeIcon} aria-hidden /><strong>{summary.balance}</strong><span>{t('cups')}</span></div>
          <div className={styles.checkInRow}>
            <Button type="button" size="sm" variant={summary.checkedInToday ? 'outline' : 'default'} loading={rewards.checkingIn} disabled={summary.checkedInToday} onClick={() => void rewards.checkIn()}>
              {summary.checkedInToday ? <Check weight="bold" size={14} aria-hidden /> : null}{t(summary.checkedInToday ? 'checkedIn' : 'checkIn')}
            </Button>
            <span>{t('streak', { count: summary.currentStreak })}</span>
          </div>
          <p className={styles.timezone}>{t('timezone')}</p>
        </section>
        <section className={styles.calendarPanel} aria-label={t('calendar')}>
          <div className={styles.sectionHeading}><h2>{monthStart ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(monthStart) : ''}</h2><span>{t('monthRatio', { count: summary.month.checkIns, days: summary.month.days })}</span></div>
          <div className={styles.calendar}>
            {weekdays.map((label, index) => <span className={styles.weekday} key={`weekday-${index}`}>{label}</span>)}
            {Array.from({ length: monthStart ? (monthStart.getUTCDay() + 6) % 7 : 0 }, (_, index) => <span key={`pad-${index}`} aria-hidden />)}
            {Array.from({ length: summary.month.days }, (_, index) => {
              const day = `${summary.month.month}-${String(index + 1).padStart(2, '0')}`;
              return <span key={day} className={styles.calendarDay} data-checked={checked.has(day)} data-today={day === summary.today}
                aria-label={t('calendarLabel', { day, state: t(checked.has(day) ? 'present' : 'absent') })} aria-current={day === summary.today ? 'date' : undefined}>
                {checked.has(day) ? <Check size={13} weight="bold" aria-hidden /> : index + 1}
              </span>;
            })}
          </div>
        </section>
      </div>
      <section className={styles.ledgerPanel}>
        <div className={styles.sectionHeading}><h2>{t('details')}</h2><span>{t('daily')}</span></div>
        {ledger.isError ? <AppAlert tone="error" title={t('ledgerError')} action={<Button variant="outline" size="sm" onClick={() => void ledger.refetch()}>{t('retry')}</Button>} /> : null}
        {ledger.isPending ? <p className={styles.muted}>{t('loading')}</p> : entries.length ? <div className={styles.ledgerScroll}><table className={styles.ledger}>
          <thead><tr><th>{t('date')}</th><th>{t('source')}</th><th>{t('amount')}</th></tr></thead>
          <tbody>{entries.map(entry => <tr key={entry.id}><td><time dateTime={entry.createdAt}>{entry.day}</time></td><td><span className={styles.ledgerSource}><Coffee size={14} weight="fill" aria-hidden />{t('daily')}</span></td><td className={styles.credit}>+{entry.amount}</td></tr>)}</tbody>
        </table></div> : !ledger.isError ? <p className={styles.empty}>{t('ledgerEmpty')}</p> : null}
        {ledger.hasNextPage ? <Button type="button" variant="ghost" size="sm" loading={ledger.isFetchingNextPage} className={styles.loadMore} onClick={() => void ledger.fetchNextPage()}>{t('loadMore')}</Button> : null}
      </section>
    </> : null}
    <section className={styles.rules}><h2>{t('rules')}</h2><ul><li>{t('ruleOne')}</li><li>{t('ruleTwo')}</li><li>{t('ruleThree')}</li></ul></section>
  </div>;
}
