'use client';

import { useUiMessage } from '../ui-message';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './page-icon-picker.messages';
import { useEffect, useRef, useState } from 'react';
import { Check, MagnifyingGlass, Smiley } from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  decodePageIcon,
  encodePageIcon,
  PageIcon,
  pageIconColors,
  pageIcons,
  pageEmojiGroups,
} from './page-icon';
import styles from './page-icon-picker.module.css';

export function PageIconPicker({
  value,
  editable = true,
  onChange,
}: {
  value?: string | null;
  editable?: boolean;
  onChange: (icon: string | null) => Promise<void>;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);
  const language = locale === 'zh-CN' ? 'zh' : 'en';

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'icons' | 'emoji'>('icons');
  const [query, setQuery] = useState('');
  const [color, setColor] = useState<string>(pageIconColors[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useUiMessage(knowledgeMessages, '');
  const search = useRef<HTMLInputElement>(null);
  const selected = decodePageIcon(value);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  async function apply(next: string | null, close = true) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onChange(next);
      if (close) setOpen(false);
    } catch {
      setError({ key: 'unableToSaveIconPleaseRetry' });
    } finally {
      setSaving(false);
    }
  }
  if (!editable)
    return value ? (
      <span className={styles.trigger}>
        <PageIcon value={value} size={24} />
      </span>
    ) : null;
  const match = query.trim().toLowerCase();
  const icons = pageIcons.filter((icon) =>
    `${icon.id} ${icon.keywords}`.toLowerCase().includes(match),
  );
  const emojiGroups = pageEmojiGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(([emoji, chinese, english]) =>
        `${emoji} ${chinese} ${english}`.toLowerCase().includes(match),
      ),
    }))
    .filter((group) => group.items.length);
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (saving && !next) return;
        if (next) {
          setColor(selected?.color ?? pageIconColors[0]);
          setTab(value && !selected ? 'emoji' : 'icons');
          setQuery('');
          setError('');
        }
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger
        className={styles.trigger}
        data-empty={!value}
        aria-label={value ? knowledgeT('changeDocumentIcon') : knowledgeT('addDocumentIcon')}
        title={value ? knowledgeT('changeIcon') : knowledgeT('addIcon')}
      >
        {value ? (
          <PageIcon value={value} size={24} />
        ) : (
          <Smiley size={24} weight="fill" aria-hidden />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        role="dialog"
        aria-label={knowledgeT('documentIconPicker')}
        aria-labelledby={undefined}
        align="start"
        collisionPadding={12}
        className={styles.panel}
      >
        <div
          onKeyDown={(event) => {
            if (event.key === 'Tab') event.stopPropagation();
          }}
        >
          <div className={styles.tabs}>
            <div
              className={styles.tabList}
              role="tablist"
              aria-label={knowledgeT('iconType')}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                  const next =
                    event.key === 'Home'
                      ? 'icons'
                      : event.key === 'End'
                        ? 'emoji'
                        : tab === 'icons'
                          ? 'emoji'
                          : 'icons';
                  setTab(next);
                  event.currentTarget
                    .querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
                    ?.focus();
                }
              }}
            >
              <button
                type="button"
                role="tab"
                data-tab="icons"
                tabIndex={tab === 'icons' ? 0 : -1}
                aria-selected={tab === 'icons'}
                onClick={() => setTab('icons')}
              >
                {knowledgeT('icon')}
              </button>
              <button
                type="button"
                role="tab"
                data-tab="emoji"
                tabIndex={tab === 'emoji' ? 0 : -1}
                aria-selected={tab === 'emoji'}
                onClick={() => setTab('emoji')}
              >
                {knowledgeT('emoji')}
              </button>
            </div>
            <button
              type="button"
              className={styles.remove}
              disabled={!value || saving}
              onClick={() => void apply(null)}
            >
              {knowledgeT('remove')}
            </button>
          </div>
          <label className={styles.search}>
            <MagnifyingGlass size={16} aria-hidden />
            <input
              ref={search}
              aria-label={knowledgeT('searchIcons')}
              placeholder={tab === 'icons' ? knowledgeT('searchIcons2') : knowledgeT('searchEmoji')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') event.stopPropagation();
              }}
            />
          </label>
          {tab === 'icons' && (
            <div className={styles.colors} role="group" aria-label={knowledgeT('iconColor')}>
              {pageIconColors.map((option) => (
                <button
                  type="button"
                  key={option}
                  aria-label={knowledgeT('iconColorValue', { v0: option })}
                  aria-pressed={color === option}
                  disabled={saving}
                  style={{ backgroundColor: option }}
                  onClick={() => {
                    setColor(option);
                    if (selected) void apply(encodePageIcon(selected.id, option), false);
                  }}
                >
                  {color === option && <Check size={13} weight="bold" aria-hidden />}
                </button>
              ))}
            </div>
          )}
          {tab === 'icons' ? (
            <div className={styles.grid} role="group" aria-label={knowledgeT('allIcons')}>
              {icons.map(({ id, label, glyph: Glyph }) => (
                <DropdownMenuItem
                  asChild
                  key={id}
                  disabled={saving}
                  onSelect={(event) => {
                    event.preventDefault();
                    void apply(encodePageIcon(id, color));
                  }}
                >
                  <button
                    type="button"
                    className={styles.choice}
                    aria-label={label[language]}
                    title={label[language]}
                    data-selected={selected?.id === id}
                  >
                    <Glyph size={24} weight="fill" style={{ color }} aria-hidden />
                  </button>
                </DropdownMenuItem>
              ))}
            </div>
          ) : (
            <div className={styles.emojiList} role="group" aria-label={knowledgeT('allEmoji')}>
              {emojiGroups.map((group) => (
                <section key={group.label.zh}>
                  <h3 className={styles.category}>{group.label[language]}</h3>
                  <div className={styles.grid}>
                    {group.items.map(([emoji, chinese, english]) => (
                      <DropdownMenuItem
                        asChild
                        key={emoji}
                        disabled={saving}
                        onSelect={(event) => {
                          event.preventDefault();
                          void apply(emoji);
                        }}
                      >
                        <button
                          type="button"
                          className={styles.choice}
                          aria-label={language === 'zh' ? chinese : english}
                          title={language === 'zh' ? chinese : english}
                          data-selected={value === emoji}
                        >
                          {emoji}
                        </button>
                      </DropdownMenuItem>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {!(tab === 'icons' ? icons.length : emojiGroups.length) && (
            <p className={styles.status}>
              {tab === 'icons' ? knowledgeT('noMatchingIcons') : knowledgeT('noMatchingEmoji')}
            </p>
          )}
          {saving && (
            <p role="status" className={styles.status}>
              {knowledgeT('saving')}
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
