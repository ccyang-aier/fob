'use client';

import { Emoji, Smiley } from '@/components/icons';
import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AnchoredPopover } from '../anchored-popover';
import { EmojiPalette } from './palette';
import { messages } from './messages';
import styles from './styles.module.css';
import type { PopoverSide } from '../popover-position';

export function EmojiPicker({ onSelect, value, disabled = false, className, side = 'bottom' }: {
  onSelect: (emoji: string) => void; value?: string; disabled?: boolean; className?: string; side?: PopoverSide;
}) {
  const { t } = useTranslation(messages);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return <>
    <button type="button" className={cn('fob-action', styles.trigger, className)} data-surface="plain" disabled={disabled}
      aria-label={t('chooseEmoji')} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
      onClick={event => setAnchor(anchor ? null : event.currentTarget)}>
      {value ? <Emoji value={value} size={24} /> : <Smiley size={16} aria-hidden />}
    </button>
    {anchor && !disabled && <AnchoredPopover anchor={anchor} onClose={() => setAnchor(null)} label={t('chooseEmoji')} width={296} side={side} align={side === 'bottom' ? 'start' : 'end'}>
      <EmojiPalette disabled={disabled} onSelect={emoji => { setAnchor(null); onSelect(emoji); }} />
    </AnchoredPopover>}
  </>;
}
