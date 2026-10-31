'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CalendarBlank, Check, Coffee, Ticket } from '@/components/icons';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/react';
import type { useCoffeeRewards } from './rewards-provider';
import { rewardsMessages } from './rewards.messages';
import styles from './rewards.module.css';

type CreditAnimation = { sequence: number; amount: number; startX: number; startY: number; endX: number; endY: number };

export function CoffeeMenuContent({ rewards, onSignIn, allowRepeat = false }: { rewards: ReturnType<typeof useCoffeeRewards>; onSignIn(): void; allowRepeat?: boolean }) {
  const { t } = useTranslation(rewardsMessages);
  const authenticated = rewards.identityStatus === 'authenticated';
  const summary = rewards.summary;
  const body = useRef<HTMLDivElement>(null), balance = useRef<HTMLElement>(null), claim = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false), lifetime = useRef(0), sequence = useRef(0);
  const [credit, setCredit] = useState<CreditAnimation | null>(null);
  useEffect(() => () => { lifetime.current++; }, []);
  useEffect(() => {
    if (!credit) return;
    const timer = setTimeout(() => setCredit(null), 650);
    return () => clearTimeout(timer);
  }, [credit]);
  async function collect() {
    if (!authenticated) { onSignIn(); return; }
    if (!summary || (summary.checkedInToday && !allowRepeat) || (allowRepeat && credit) || inFlight.current || rewards.checkingIn) return;
    const epoch = lifetime.current;
    inFlight.current = true;
    try {
      const result = await rewards.checkIn();
      if (epoch !== lifetime.current || !result?.awarded || result.accountId !== summary.accountId || result.today !== summary.today) return;
      const root = body.current?.getBoundingClientRect(), from = claim.current?.getBoundingClientRect(), to = balance.current?.getBoundingClientRect();
      if (root && from && to) setCredit({ sequence: ++sequence.current, amount: result.reward, startX: from.left - root.left + from.width / 2 - 10, startY: from.top - root.top + from.height / 2 - 10, endX: to.left - root.left + to.width / 2 - 10, endY: to.top - root.top + to.height / 2 - 10 });
    } finally { if (epoch === lifetime.current) inFlight.current = false; }
  }
  return <div ref={body} className={styles.menuBody} data-crediting={Boolean(credit)}>
    <div className={styles.menuBalance} aria-live="polite">
      <span><Coffee size={16} aria-hidden />{t('balance')}</span>
      {summary ? <strong ref={balance} className={styles.balanceValue}>{summary.balance}<small>{t('cups')}</small></strong> : <span className={styles.menuStatus}>{t(!authenticated ? 'signInToView' : rewards.error ? 'balanceUnavailable' : 'loading')}</span>}
    </div>
    <div className={`${styles.menuRow} ${styles.menuCheckInRow}`}>
      <CalendarBlank size={16} aria-hidden />
      <div className={styles.menuCopy}><span>{t('daily')}</span><small>{summary ? t('streak', { count: summary.currentStreak }) : t('dailyReward')}</small></div>
      <Button ref={claim} size="sm" variant={summary?.checkedInToday ? 'ghost' : 'default'} className={styles.menuCheckIn} data-claimed={Boolean(summary?.checkedInToday)} data-repeatable={allowRepeat || undefined} aria-label={allowRepeat ? t('previewAgain') : summary?.checkedInToday ? t('checkedIn') : undefined} aria-disabled={(summary?.checkedInToday && !allowRepeat) || undefined} disabled={authenticated && !summary} onClick={() => void collect()}>
        {summary?.checkedInToday ? <><span className={styles.claimSeal}><Check size="9px" aria-hidden /></span><span>{t('claimed')}</span><small className={styles.claimAmount}>{t('dailyCup')}</small></> : <><Coffee size={14} className={styles.claimCup} aria-hidden />{t(!authenticated ? 'signIn' : 'checkIn')}</>}
      </Button>
    </div>
    <div className={styles.menuRow}>
      <Ticket size={16} aria-hidden /><span className={styles.menuCopy}>{t('vouchers')}</span><span className={styles.menuStatus}>{t('vouchersUnavailable')}</span>
    </div>
    {authenticated && rewards.error ? <AppAlert tone="error" title={t('unavailable')} action={<Button size="sm" variant="outline" onClick={rewards.refresh}>{t('retry')}</Button>} /> : null}
    {credit && <span key={credit.sequence} className={styles.creditLayer} aria-hidden data-coffee-credit style={{ '--coffee-start-x': `${credit.startX}px`, '--coffee-start-y': `${credit.startY}px`, '--coffee-mid-x': `${credit.startX + 6}px`, '--coffee-mid-y': `${credit.startY - 26}px`, '--coffee-end-x': `${credit.endX}px`, '--coffee-end-y': `${credit.endY}px` } as CSSProperties}>
      <span className={styles.creditCup}><Coffee size="18px" /></span>
      <span className={styles.creditAmount} style={{ left: credit.endX - 24, top: credit.endY + 4 }}>{t('creditAmount', { count: credit.amount })}</span>
    </span>}
  </div>;
}
