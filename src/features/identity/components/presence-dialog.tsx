'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { SelectionCheck, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import { useTranslation } from '@/lib/i18n';
import { useIdentity } from '../identity-context';
import { customStatusMaxLength, getPresenceOptions } from '../presence';
import { messages } from './i18n/account-item.messages';
import styles from './presence-dialog.module.css';

export function PresenceDialog({ onClose }: { onClose(): void }) {
  const { t, locale } = useTranslation(messages);
  const { presencePreference, customStatus, setPresence } = useIdentity();
  const [preference, setPreference] = useState(presencePreference);
  const [emoji, setEmoji] = useState(customStatus?.emoji ?? '💬');
  const [text, setText] = useState(customStatus?.text ?? '');
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); setPresence(preference, text.trim() ? { emoji, text: text.trim() } : null); onClose(); }}>
      <header className={styles.header}><h2 id={id}>{t('设置状态')}</h2><button type="button" className="fob-action" aria-label={t('关闭')} onClick={onClose}><X size={16} /></button></header>
      <div className={styles.body}>
        <fieldset className={styles.options}><legend className="sr-only">{t('当前设备状态')}</legend>
          {getPresenceOptions(locale).map(option => <label key={option.value} className={`fob-action ${styles.option}`} data-selected={preference === option.value}>
            <input type="radio" name="presence" value={option.value} checked={preference === option.value} onChange={() => setPreference(option.value)} />
            <span aria-hidden className={styles.dot} style={{ background: option.color }} />
            <span>{option.label}</span>{preference === option.value && <SelectionCheck className={styles.check} />}
          </label>)}
        </fieldset>
        <div className={styles.custom}>
          <label htmlFor={`${id}-text`}>{t('自定义状态')}</label>
          <div className={styles.composer}>
            <EmojiPicker value={emoji} onSelect={setEmoji} className={styles.emoji} />
            <input id={`${id}-text`} value={text} onChange={event => setText(event.target.value)} maxLength={customStatusMaxLength} placeholder={t('此刻在做什么？')} autoComplete="off" />
          </div>
        </div>
      </div>
      <footer className={styles.footer}>
        <Button type="button" variant="ghost" size="sm" disabled={!text} onClick={() => { setText(''); setEmoji('💬'); }}>{t('清除状态')}</Button>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('取消')}</Button>
        <Button type="submit" size="sm">{t('保存')}</Button>
      </footer>
    </form>
  </dialog>;
}
