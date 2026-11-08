'use client';

import { useLayoutEffect, type ReactNode, type RefObject } from 'react';
import type { AssistantModelSelection, AssistantSettings } from '@fob/shared/knowledge/contracts';
import { ArrowUp, CaretDown, FileText, Stop, X } from '@/components/icons';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { AIModelPicker } from './model-picker';
import { assistantMessages } from './assistant.messages';
import styles from './assistant.module.css';

export interface AssistantDraft {
  prompt: string;
  mode: 'document' | 'knowledgeBase';
  tier: 'fast' | 'smart';
  model: AssistantModelSelection | null;
}

function Choice<T extends string>({ label, value, choices, onChange, disabled }: { label: string; value: T; choices: readonly { value: T; label: string }[]; onChange(value: T): void; disabled: boolean }) {
  return <DropdownMenu><DropdownMenuTrigger type="button" className={styles.choice} aria-label={label} disabled={disabled}>
    <span>{choices.find(item => item.value === value)?.label}</span><CaretDown size={10} aria-hidden />
  </DropdownMenuTrigger><DropdownMenuContent align="start" density="compact"><DropdownMenuRadioGroup value={value} onValueChange={next => onChange(next as T)}>
    {choices.map(item => <DropdownMenuRadioItem key={item.value} value={item.value} emphasizeSelection={false}>{item.label}</DropdownMenuRadioItem>)}
  </DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>;
}

export function AssistantComposer({ draft, onChange, settings, defaultModel, selection, onClearSelection, busy, applying, ready, truncated, notice, inputRef, onSend, onStop, onManage }: {
  draft: AssistantDraft; onChange(patch: Partial<AssistantDraft>): void; settings?: AssistantSettings; defaultModel?: string | null;
  selection: string; onClearSelection(): void; busy: boolean; applying: boolean; ready: boolean; truncated: boolean;
  notice?: ReactNode; inputRef: RefObject<HTMLTextAreaElement | null>; onSend(): void; onStop(): void; onManage(): void;
}) {
  const { t } = useTranslation(assistantMessages);
  const locked = busy || applying;
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.max(44, Math.min(input.scrollHeight, 120))}px`;
  }, [draft.prompt, inputRef]);
  return <form className={styles.composer} onSubmit={event => { event.preventDefault(); onSend(); }}>
    {notice && <div className={styles.notices}>{notice}</div>}
    <div className={styles.inputBox} data-busy={busy || undefined}>
      {selection && <div className={styles.selection} role="group" aria-label={t('selected')}>
        <FileText size={12} aria-hidden /><p title={selection}>{selection}</p>
        <div className={styles.selectionActions}>{(['improve', 'translate'] as const).map(action => <button key={action} type="button" className="fob-action" aria-label={t(action)} disabled={locked} onClick={() => { onChange({ prompt: t(action === 'improve' ? 'improvePrompt' : 'translatePrompt') }); inputRef.current?.focus(); }}>{t(action === 'improve' ? 'polishAction' : 'translateAction')}</button>)}</div>
        <button type="button" className={`fob-action ${styles.iconButton}`} aria-label={t('clearSelection')} disabled={locked} onClick={onClearSelection}><X size={12} aria-hidden /></button>
      </div>}
      <textarea ref={inputRef} aria-label={t('placeholder')} placeholder={t('placeholder')} maxLength={selection ? Math.max(1, 7998 - selection.length) : 8000} rows={2}
        value={draft.prompt} readOnly={locked} onChange={event => onChange({ prompt: event.target.value })}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!locked) onSend(); }
        }} />
      <div className={styles.composerTools}>
        <AIModelPicker connections={settings?.connections ?? []} value={draft.model} onChange={model => onChange({ model })} defaultLabel={defaultModel || t('platform')} label={t('model')} disabled={locked} className={styles.modelControl} onManage={onManage} />
        <Choice<'document' | 'knowledgeBase'> label={t('scope')} value={draft.mode} onChange={mode => onChange({ mode })} disabled={locked} choices={[{ value: 'document', label: t('document') }, { value: 'knowledgeBase', label: t('knowledgeBase') }]} />
        <Choice<'fast' | 'smart'> label={t('tier')} value={draft.tier} onChange={tier => onChange({ tier })} disabled={locked} choices={[{ value: 'fast', label: t('fast') }, { value: 'smart', label: t('smart') }]} />
        <Tooltip><TooltipTrigger asChild>{busy
          ? <button type="button" className={styles.send} aria-label={t('stop')} onClick={onStop}><Stop size={14} aria-hidden /></button>
          : <button type="submit" className={styles.send} aria-label={t('send')} disabled={applying || !draft.prompt.trim() || !ready}><ArrowUp size={18} aria-hidden /></button>}
        </TooltipTrigger><TooltipContent>{t(busy ? 'stop' : 'send')}</TooltipContent></Tooltip>
      </div>
    </div>
    {truncated && <p className={styles.composerHint} role="status">{t('truncated')}</p>}
  </form>;
}
