'use client';

import { Smiley } from '@/components/icons';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AnchoredPopover } from './anchored-popover';
import { messages } from './emoji-picker.messages';
import styles from './emoji-picker.module.css';

const EMOJI = [
  ['🙂', 'smile'], ['😄', 'happy'], ['😆', 'laugh'], ['😂', 'joy'],
  ['😉', 'wink'], ['😍', 'love'], ['😎', 'cool'], ['🤔', 'think'],
  ['😮', 'surprise'], ['😊', 'shy'], ['😌', 'relieved'], ['😔', 'sad'],
  ['😭', 'cry'], ['😟', 'worried'], ['😴', 'sleepy'], ['🥳', 'party'],
  ['👍', 'thumbsUp'], ['👎', 'thumbsDown'], ['👏', 'clap'], ['👋', 'wave'],
  ['🙏', 'thanks'], ['💪', 'strong'], ['👌', 'ok'], ['🤝', 'handshake'],
  ['❤️', 'heart'], ['💙', 'blueHeart'], ['💚', 'greenHeart'], ['✨', 'sparkle'],
  ['⭐', 'star'], ['🔥', 'fire'], ['🎉', 'celebration'], ['🎊', 'confetti'],
  ['✅', 'check'], ['🎯', 'target'], ['💡', 'idea'], ['🚀', 'rocket'],
  ['👀', 'eyes'], ['💯', 'hundred'], ['📌', 'pin'], ['📝', 'note'],
  ['📅', 'calendar'], ['🕒', 'clock'], ['☕', 'coffee'], ['🎂', 'cake'],
  ['🎁', 'gift'], ['🌸', 'flower'], ['🌈', 'rainbow'], ['☀️', 'sun'],
] as const;

export function EmojiPicker({ onSelect, disabled = false, className }: {
  onSelect: (emoji: string) => void; disabled?: boolean; className?: string;
}) {
  const { t } = useTranslation(messages);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState('');
  const optionsRef = useRef<HTMLDivElement>(null);
  const normalized = query.trim().toLocaleLowerCase();
  const matches = EMOJI.filter(([emoji, key]) => !normalized || emoji.includes(normalized) || messages[key].some(name => name.toLocaleLowerCase().includes(normalized)));

  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const options = [...optionsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []];
    if (!options.length) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = index < 0 ? (event.key === 'ArrowUp' ? options.length - 1 : 0)
      : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : event.key === 'ArrowRight' ? (index + 1) % options.length
          : event.key === 'ArrowLeft' ? (index - 1 + options.length) % options.length
            : event.key === 'ArrowDown' ? Math.min(index + 8, options.length - 1) : Math.max(index - 8, 0);
    options[next].focus();
  }

  return <>
    <button type="button" className={cn('fob-action', styles.trigger, className)} data-surface="plain" disabled={disabled}
      aria-label={t('chooseEmoji')} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
      onClick={event => { setQuery(''); setAnchor(anchor ? null : event.currentTarget); }}>
      <Smiley size={16} aria-hidden />
    </button>
    {anchor && !disabled && <AnchoredPopover anchor={anchor} onClose={() => setAnchor(null)} label={t('chooseEmoji')} width={272} align="start">
      <div className={styles.picker}>
        <input data-autofocus type="search" className={styles.search} value={query} autoComplete="off" aria-label={t('searchEmoji')}
          placeholder={t('searchEmoji')} onChange={event => setQuery(event.target.value)} onKeyDown={navigate} />
        <div ref={optionsRef} className={styles.grid} role="group" aria-label={t('chooseEmoji')} onKeyDown={navigate}>
          {matches.map(([emoji, key]) => <button key={key} type="button" className={`fob-action ${styles.emoji}`} data-surface="plain" aria-label={t(key)}
            onClick={() => { setAnchor(null); onSelect(emoji); }}><span aria-hidden>{emoji}</span></button>)}
        </div>
        {!matches.length && <p className={styles.empty} role="status">{t('noResults')}</p>}
      </div>
    </AnchoredPopover>}
  </>;
}
