'use client';

import { useId, useRef, useState } from 'react';
import { Plus, PushPin, PushPinSlash, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { orderedLabels, type MemberLabel } from './members.data';
import { messages } from './members.messages';
import styles from './members.module.css';

export function MemberLabelEditor({ value, options, onChange }: { value: MemberLabel[]; options: string[]; onChange: (labels: MemberLabel[]) => void }) {
  const { t } = useTranslation(messages);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const name = query.trim();
  const selected = (name: string) => value.some(label => label.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const suggestions = options.filter(option => !selected(option) && option.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  function add(name: string) {
    const trimmed = name.trim();
    if (!trimmed || selected(trimmed)) return;
    onChange([...value, { name: trimmed, pinned: false }]);
    setQuery('');
    input.current?.focus();
  }
  return <fieldset className={styles.labelEditor}>
    <legend>{t('labels')}</legend>
    <div className={styles.editableLabels}>
      {orderedLabels(value).map(label => <span className={styles.editableLabel} key={label.name} data-pinned={label.pinned || undefined}>
        <span title={label.name}>{label.name}</span>
        <button type="button" className="fob-action" aria-label={t(label.pinned ? 'unpinLabel' : 'pinLabel', { name: label.name })} aria-pressed={label.pinned}
          onClick={() => onChange(value.map(item => item.name === label.name ? { ...item, pinned: !item.pinned } : item))}>
          {label.pinned ? <PushPinSlash size={13} /> : <PushPin size={13} />}
        </button>
        <button type="button" className="fob-action" aria-label={t('removeLabel', { name: label.name })} onClick={() => onChange(value.filter(item => item.name !== label.name))}><X size={13} /></button>
      </span>)}
      {!value.length && <span className={styles.noLabels}>{t('noLabels')}</span>}
    </div>
    <div className={styles.labelInput}>
      <label htmlFor={inputId} className="sr-only">{t('addLabel')}</label>
      <input ref={input} id={inputId} value={query} maxLength={40} aria-describedby={hintId} placeholder={t('labelInput')} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add(query); } }} />
      <Button type="button" size="sm" variant="outline" disabled={!name || selected(name)} onClick={() => add(query)}><Plus size={14} />{t('addLabel')}</Button>
    </div>
    {suggestions.length > 0 && <div className={styles.labelSuggestions}>
      {suggestions.map(name => <button key={name} type="button" className="fob-action" aria-label={t('reuseLabel', { name })} onClick={() => add(name)}><Plus size={12} />{name}</button>)}
    </div>}
    <p id={hintId} className={styles.pinHint}><PushPin size={12} aria-hidden />{t('pinHint')}</p>
  </fieldset>;
}
