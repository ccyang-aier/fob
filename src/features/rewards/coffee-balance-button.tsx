'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoffeeCheckInResult } from '@fob/shared/rewards';
import { Coffee } from '@/components/icons';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/react';
import { useCoffeeRewards } from './rewards-provider';
import { CoffeeMenuContent } from './coffee-menu-content';
import { rewardsMessages } from './rewards.messages';
import styles from './rewards.module.css';

type Popup = { anchor: HTMLButtonElement; mode: 'hover' | 'pinned' };

export function CoffeeBalanceButton() {
  const rewards = useCoffeeRewards();
  return <CoffeeMenuTrigger key={rewards.principal} rewards={rewards} />;
}

function CoffeeMenuTrigger({ rewards }: { rewards: ReturnType<typeof useCoffeeRewards> }) {
  const { t } = useTranslation(rewardsMessages);
  const developmentPreview = process.env.NODE_ENV === 'development';
  const [preview, setPreview] = useState(developmentPreview);
  const [previewClaims, setPreviewClaims] = useState(0);
  const previewActive = developmentPreview && preview && rewards.identityStatus === 'authenticated' && Boolean(rewards.summary);
  const previewSummary = previewActive && rewards.summary ? { ...rewards.summary, balance: rewards.summary.balance + previewClaims, checkedInToday: previewClaims > 0 } : undefined;
  const previewCheckIn = async (): Promise<CoffeeCheckInResult | undefined> => {
    if (!previewSummary) return;
    setPreviewClaims(count => count + 1);
    return { ...previewSummary, balance: previewSummary.balance + 1, checkedInToday: true, awarded: true, reward: 1 };
  };
  const displayedRewards = previewSummary ? { ...rewards, summary: previewSummary, checkingIn: false, checkIn: previewCheckIn } : rewards;
  const [popup, setPopup] = useState<Popup | null>(null);
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelTimers = useCallback(() => { clearTimeout(opening.current); clearTimeout(closing.current); }, []);
  const close = useCallback(() => { cancelTimers(); setPopup(null); }, [cancelTimers]);
  useEffect(() => cancelTimers, [cancelTimers]);
  const leave = () => {
    clearTimeout(opening.current);
    clearTimeout(closing.current);
    if (popup?.mode === 'hover') closing.current = setTimeout(() => setPopup(current => current?.mode === 'hover' ? null : current), 220);
  };
  const label = displayedRewards.summary ? t(previewActive ? 'previewBalanceLabel' : 'balanceLabel', { count: displayedRewards.summary.balance }) : t('open');
  return <>
    <button type="button" className={`fob-action ${styles.balanceButton}`} data-surface="plain" aria-label={label} aria-haspopup="dialog" aria-expanded={Boolean(popup)}
      disabled={rewards.identityStatus === 'checking'}
      onPointerEnter={event => {
        if (event.pointerType !== 'mouse' || event.buttons) return;
        cancelTimers();
        const anchor = event.currentTarget;
        opening.current = setTimeout(() => setPopup(current => current ?? { anchor, mode: 'hover' }), 120);
      }}
      onPointerLeave={leave}
      onClick={event => {
        cancelTimers();
        const anchor = event.currentTarget;
        setPopup(current => current?.mode === 'pinned' ? null : { anchor, mode: 'pinned' });
      }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); cancelTimers(); setPopup({ anchor: event.currentTarget, mode: 'pinned' }); }
      }}>
      <Coffee size={16} aria-hidden />
      {displayedRewards.summary ? <span className={styles.balanceNumber} aria-hidden>{displayedRewards.summary.balance > 99 ? '99+' : displayedRewards.summary.balance}</span> : null}
    </button>
    {popup && <AnchoredPopover anchor={popup.anchor} onClose={close} label={t('title')} align="end" width={296} className={styles.coffeeMenu} autoFocus={popup.mode === 'pinned'}
      onMouseEnter={() => clearTimeout(closing.current)} onMouseLeave={leave}>
      <CoffeeMenuContent key={previewActive ? 'preview' : 'live'} rewards={displayedRewards} allowRepeat={previewActive} onSignIn={() => { close(); rewards.openSignIn(); }} />
      {developmentPreview && rewards.identityStatus === 'authenticated' && rewards.summary && <div className={styles.previewControls}>
        <span>{t(previewActive ? 'previewHint' : 'previewOff')}</span>
        <Button variant="ghost" size="sm" className={styles.previewToggle} onClick={() => { setPreview(current => !current); setPreviewClaims(0); }}>{t(previewActive ? 'endPreview' : 'startPreview')}</Button>
      </div>}
    </AnchoredPopover>}
  </>;
}
