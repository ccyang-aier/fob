'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Coffee } from '@/components/icons';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
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
  const label = rewards.summary ? t('balanceLabel', { count: rewards.summary.balance }) : t('open');
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
      {rewards.summary ? <span className={styles.balanceNumber} aria-hidden>{rewards.summary.balance > 99 ? '99+' : rewards.summary.balance}</span> : null}
    </button>
    {popup && <AnchoredPopover anchor={popup.anchor} onClose={close} label={t('title')} align="end" width={296} className={styles.coffeeMenu} autoFocus={popup.mode === 'pinned'}
      onMouseEnter={() => clearTimeout(closing.current)} onMouseLeave={leave}>
      <CoffeeMenuContent rewards={rewards} onSignIn={() => { close(); rewards.openSignIn(); }} />
    </AnchoredPopover>}
  </>;
}
