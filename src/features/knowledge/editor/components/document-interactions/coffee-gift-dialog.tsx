'use client';
import { useEffect, useRef, useState } from 'react';
import type { DocumentInteractions, PageScope } from '@fob/shared/knowledge/contracts';
import { Coffee } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useTranslation } from '@/lib/i18n';
import { useCoffeeRewards } from '@/features/rewards';
import { DocumentModal } from '../../../sharing/document-modal';
import { DocumentAvatar } from '../../../sharing/document-share-dialog';
import { documentInteractionsApi, DocumentInteractionError } from './api';
import { interactionMessages } from './messages';
import styles from './styles.module.css';

export function CoffeeGiftDialog({ scope, recipient, onClose, onSent }: { scope: PageScope; recipient: DocumentInteractions['recipient']; onClose(): void; onSent(amount: number): void }) {
  const { t } = useTranslation(interactionMessages), rewards = useCoffeeRewards();
  const [amount, setAmount] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false), request = useRef<{ amount: number; id: string } | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const available = rewards.summary?.balance;
  const valid = Number.isInteger(amount) && amount >= 1 && amount <= 1000 && available !== undefined && amount <= available;
  async function send() {
    if (!valid || pending.current || !rewards.accountId) return;
    pending.current = true; setBusy(true); setError(null);
    if (!request.current || request.current.amount !== amount) request.current = { amount, id: crypto.randomUUID() };
    try {
      const result = await documentInteractionsApi.gift(scope, rewards.accountId, amount, request.current.id);
      if (!active.current) return;
      rewards.refresh(); onSent(result.amount);
    } catch (failure) {
      if (!active.current) return;
      if (failure instanceof DocumentInteractionError && failure.code === 'INSUFFICIENT_COFFEE') { setError(t('insufficient')); rewards.refresh(); }
      else setError(t('failed'));
    } finally { pending.current = false; if (active.current) setBusy(false); }
  }
  return <DocumentModal title={t('giftTitle')} onClose={() => { if (!pending.current) onClose(); }}>
    <form className={styles.giftForm} onSubmit={event => { event.preventDefault(); void send(); }}>
      <div className={styles.recipient}><DocumentAvatar name={recipient.name} image={recipient.image} /><strong>{t('recipient', { name: recipient.name })}</strong><Coffee size={20} aria-hidden /></div>
      <p className={styles.balance}>{available !== undefined ? t('balance', { count: available }) : t(rewards.error ? 'balanceFailed' : 'loading')}</p>
      <div className={styles.quantities} role="group" aria-label={t('quantity')}>{[1,3,5,10].map(count => <button key={count} type="button" className="fob-action" data-surface="plain" aria-pressed={amount === count} data-active={amount === count || undefined} disabled={busy || available === undefined || count > available} onClick={() => setAmount(count)}><Coffee size={16} aria-hidden />{t('cups', { count })}</button>)}</div>
      <label className={styles.quantity}><span>{t('quantity')}</span><input type="number" inputMode="numeric" min={1} max={Math.min(1000,available ?? 1000)} step={1} required value={Number.isNaN(amount) ? '' : amount} onChange={event => setAmount(event.currentTarget.valueAsNumber)} disabled={busy} /></label>
      {available !== undefined && amount > available && <AppAlert tone="warning" title={t('insufficient')} />}
      {error && <AppAlert tone="error" title={error} />}
      {Boolean(rewards.error) && <Button type="button" variant="outline" size="sm" onClick={rewards.refresh}>{t('retry')}</Button>}
      <footer><Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button type="submit" size="sm" loading={busy} disabled={!valid}>{t('send', { count: Number.isFinite(amount) ? amount : 0 })}</Button></footer>
    </form>
  </DocumentModal>;
}
