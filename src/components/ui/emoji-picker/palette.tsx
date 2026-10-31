'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { Emoji } from '@/components/icons';
import { emojiGroups, normalizeEmoji } from '@/components/icons/emoji-catalog';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './styles.module.css';

/** Shared searchable palette for callouts, messages and future emoji entry points. */
export function EmojiPalette({ onSelect, value, disabled = false }: { onSelect: (emoji: string) => void; value?: string; disabled?: boolean }) {
  const { locale, t } = useTranslation(messages);
  const language = locale === 'zh-CN' ? 'zh' : 'en';
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const search = query.trim().toLocaleLowerCase();
  const groups = emojiGroups.filter(group => search || !category || category === group.id).map(group => ({ ...group, items: group.items.filter(entry => !search || `${entry.emoji} ${entry.name.zh} ${entry.name.en} ${entry.keywords}`.toLocaleLowerCase().includes(search)) })).filter(group => group.items.length);

  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const options = [...optionsRef.current?.querySelectorAll<HTMLButtonElement>('button[data-emoji]:not(:disabled)') ?? []];
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

  return <div className={styles.picker}>
    <input data-autofocus type="search" className={styles.search} value={query} autoComplete="off" aria-label={t('searchEmoji')} placeholder={t('searchEmoji')} onChange={event => setQuery(event.target.value)} onKeyDown={navigate} />
    <div className={styles.categories} role="group" aria-label={t('emojiCategories')}>
      {emojiGroups.map(group => <button key={group.id} type="button" className={`fob-action ${styles.categoryButton}`} data-surface="plain" aria-label={group.label[language]} title={group.label[language]} aria-pressed={category === group.id} onClick={() => setCategory(category === group.id ? null : group.id)}><Emoji value={group.items[0].emoji} size={24} /></button>)}
    </div>
    <div ref={optionsRef} className={styles.options} role="group" aria-label={t('chooseEmoji')} onKeyDown={navigate}>
      {groups.map(group => <section key={group.id}>
        <h3 className={styles.categoryLabel}>{group.label[language]}</h3>
        <div className={styles.grid}>{group.items.map(entry => <button key={entry.hexcode} type="button" className={`fob-action ${styles.emoji}`} data-surface="plain" data-emoji={entry.emoji} disabled={disabled} aria-label={entry.name[language]} aria-pressed={normalizeEmoji(value ?? '') === normalizeEmoji(entry.emoji)} title={entry.name[language]} onClick={() => onSelect(entry.emoji)}><Emoji value={entry.emoji} size={28} /></button>)}</div>
      </section>)}
      {!groups.length && <p className={styles.empty} role="status">{t('noResults')}</p>}
    </div>
  </div>;
}
