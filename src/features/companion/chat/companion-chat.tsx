'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { AssistantSource, AssistantTurn } from '@fob/shared/knowledge/contracts';
import { ArrowDown, ArrowLeft, ArrowUp, CaretDown, ClockCounterClockwise, Copy, DotsThree, GearSix, Heart, Plus, Stop, Trash, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/relative-time';
import { assistantErrorKey } from '@/features/knowledge/ai/errors';
import { CompanionChatAnswer, citedCompanionSources } from './companion-chat-answer';
import { companionChatMessages } from './companion-chat.messages';
import { useCompanionChatPlacement } from './use-companion-chat-placement';
import { followCompanionBubbleLayout, useCompanionBubbleEntrance } from './use-companion-bubble-entrance';
import type { CompanionChatContext, CompanionChatController, CompanionChatMode } from './types';
import styles from './companion-chat.module.css';

type Props = { open: boolean; anchor: RefObject<HTMLElement | null>; context: CompanionChatContext; chat: CompanionChatController; onClose(): void; onSource(source: AssistantSource): void; onSettings(): void; onInteract(): void };

function SourceLinks({ turn, onSource }: { turn: AssistantTurn; onSource(source: AssistantSource): void }) {
  const { t } = useTranslation(companionChatMessages), sources = citedCompanionSources(turn.answer, turn.sources);
  if (!sources.length) return null;
  return <div className={styles.answerFooter} data-companion-source-footer>{sources.length === 1 ? <button type="button" className={styles.source} onClick={() => onSource(sources[0])} title={sources[0].title}>{t('viewSource')}</button> : <DropdownMenu><DropdownMenuTrigger className={styles.source}>{t('viewSource')}<span>· {sources.length}</span><CaretDown size={10} aria-hidden /></DropdownMenuTrigger>
    <DropdownMenuContent density="compact" align="start" className={styles.sourceMenu}>{sources.map(source => <DropdownMenuItem key={source.id} className={styles.sourceItem} onSelect={() => onSource(source)}><span>{source.title}</span><small>{source.excerpt}</small></DropdownMenuItem>)}</DropdownMenuContent>
  </DropdownMenu>}</div>;
}

function AnswerActions({ turn, chat }: { turn: AssistantTurn; chat: CompanionChatController }) {
  const { t } = useTranslation(companionChatMessages), { notify } = useAppAlert();
  async function copy() {
    try { await navigator.clipboard.writeText(turn.answer.replace(/\[([^\]]+)\]\(fob-source:\d+\)/g, '$1')); notify('success', t('copied')); }
    catch { notify('error', t('failed')); }
  }
  return <DropdownMenu><DropdownMenuTrigger className={`${styles.icon} ${styles.answerActions}`} aria-label={t('actions')}><DotsThree size={14} aria-hidden /></DropdownMenuTrigger><DropdownMenuContent density="compact" align="end">
    {turn.answer && <DropdownMenuItem onSelect={() => void copy()}><Copy size={14} aria-hidden />{t('copy')}</DropdownMenuItem>}
    <DropdownMenuItem disabled={chat.busy || !chat.ready} onSelect={() => void chat.retry(turn).catch(() => notify('error', t('failed')))}><ArrowUp size={14} aria-hidden />{t('retryAnswer')}</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}

export function CompanionChat({ open, anchor, context, chat, onClose, onSource, onSettings, onInteract }: Props) {
  const { t, locale } = useTranslation(companionChatMessages), { notify } = useAppAlert();
  const key = `${context.userId ?? 'guest'}:${context.knowledgeBaseId ?? context.status}`;
  const [draft, setDraft] = useState({ key, text: '' });
  const [choice, setChoice] = useState<{ key: string; mode: CompanionChatMode }>({ key, mode: 'document' });
  const [history, setHistory] = useState({ key, open: false, filter: '' });
  const [deletion, setDeletion] = useState<{ key: string; id: string | null; pending: boolean }>({ key, id: null, pending: false });
  const [submitting, setSubmitting] = useState<string | null>(null), [latest, setLatest] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true), sending = useRef(false), deleting = useRef(false), mounted = useRef(false), currentKey = useRef(key);
  const surface = useCompanionChatPlacement(anchor, open);
  useLayoutEffect(() => { currentKey.current = key; }, [key]);
  const text = draft.key === key ? draft.text : '';
  const mode = context.document ? choice.key === key ? choice.mode : 'document' : 'knowledgeBase';
  const historyOpen = history.key === key && history.open, filter = history.key === key ? history.filter : '';
  const removeId = deletion.key === key ? deletion.id : null, removing = deletion.key === key && deletion.pending;
  const busy = chat.busy || submitting === key, available = context.status === 'ready';
  const pending = available && (chat.loading || !chat.conversation && chat.settingsLoading);
  const turns = available && !chat.loading ? chat.conversation?.turns ?? [] : [];
  const last = turns.at(-1);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    if (!open || historyOpen) return;
    const node = input.current;
    if (node) { node.style.height = '0px'; node.style.height = `${Math.max(28, Math.min(node.scrollHeight, 88))}px`; }
  }, [text, open, historyOpen]);
  useEffect(() => {
    if (!open || historyOpen) return;
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, historyOpen, key]);
  useLayoutEffect(() => {
    if (!open || historyOpen || !follow.current) return;
    const node = transcript.current;
    if (node?.hasAttribute('data-bubble-opening')) followCompanionBubbleLayout(node);
    else if (node) node.scrollTo({ top: node.scrollHeight });
  }, [open, historyOpen, last?.answer, last?.status, turns.length]);
  useCompanionBubbleEntrance({ transcriptRef: transcript, followRef: follow, open, pending, historyOpen, conversationKey: `${key}:${chat.conversation?.id ?? 'empty'}` });

  async function send() {
    const question = text.trim(), requestKey = key;
    if (!question || !available || !chat.ready || busy || sending.current) return;
    sending.current = true; setSubmitting(requestKey); follow.current = true; setLatest(false);
    setHistory({ key, open: false, filter: '' }); chat.clearError();
    try {
      await chat.send(question, mode, () => {
        if (mounted.current && currentKey.current === requestKey) setDraft(current => current.key === requestKey && current.text === text ? { key: requestKey, text: '' } : current);
      });
    } catch { if (mounted.current && currentKey.current === requestKey) notify('error', t('failed')); }
    finally { sending.current = false; if (mounted.current) setSubmitting(current => current === requestKey ? null : current); }
  }
  async function remove() {
    if (!removeId || removing || deleting.current) return;
    deleting.current = true;
    const requestKey = key;
    setDeletion({ key, id: removeId, pending: true });
    try { await chat.removeConversation(removeId); if (mounted.current && currentKey.current === requestKey) setDeletion({ key, id: null, pending: false }); }
    catch { if (mounted.current && currentKey.current === requestKey) { setDeletion(current => ({ ...current, pending: false })); notify('error', t('failed')); } }
    finally { deleting.current = false; }
  }
  function escape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented || !(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return;
    if (event.target.closest('[role="menu"], [role="listbox"], dialog')) return;
    event.preventDefault(); event.stopPropagation();
    if (removeId) setDeletion({ key, id: null, pending: false });
    else if (historyOpen) setHistory({ key, open: false, filter: '' });
    else onClose();
  }
  function startNew() { chat.newConversation(); setDraft({ key, text: '' }); setHistory({ key, open: false, filter: '' }); follow.current = true; setLatest(false); input.current?.focus(); }
  const stateLabel = context.status === 'checking' ? t('checking') : context.status === 'signed-out' ? t('signedOut') : context.status === 'local' ? t('local') : context.status === 'error' ? t('contextError') : t('noLibrary');
  const results = chat.conversations.filter(item => item.title.toLocaleLowerCase(locale).includes(filter.trim().toLocaleLowerCase(locale)));
  if (!open) return null;
  return <div ref={surface} className={styles.chat} role="dialog" aria-modal="false" aria-label={t('chat')} data-companion-chat data-chat-pending={pending || undefined} onKeyDown={escape}>
    <div className={styles.controls}>
      <DropdownMenu><DropdownMenuTrigger className={styles.scope} aria-label={t('scope')} title={mode === 'document' ? context.document?.title : context.knowledgeBaseName} disabled={!available || busy}><span>{t(mode === 'document' ? 'document' : 'knowledgeBase')}</span><CaretDown size={10} aria-hidden /></DropdownMenuTrigger><DropdownMenuContent density="compact" align="end" className={styles.menu}>
        <DropdownMenuRadioGroup value={mode} onValueChange={next => setChoice({ key, mode: next as CompanionChatMode })}>
          <DropdownMenuRadioItem value="document" disabled={!context.document} emphasizeSelection={false}>{t('document')}{!context.document && <small>{t('noDocument')}</small>}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="knowledgeBase" emphasizeSelection={false}>{t('knowledgeBase')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent></DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger className={`${styles.icon} ${styles.secondary}`} aria-label={t('more')}><DotsThree size={14} aria-hidden /></DropdownMenuTrigger><DropdownMenuContent density="compact" align="end" className={styles.menu}>
        <DropdownMenuItem disabled={!available || busy} onSelect={startNew}><Plus size={14} aria-hidden />{t('newConversation')}</DropdownMenuItem>
        <DropdownMenuItem disabled={!available || busy} onSelect={() => { setHistory({ key, open: true, filter: '' }); void chat.refresh(); }}><ClockCounterClockwise size={14} aria-hidden />{t('history')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {available && context.canConfigureAI && <DropdownMenuItem onSelect={onSettings}><GearSix size={14} aria-hidden />{t('settings')}</DropdownMenuItem>}
        <DropdownMenuItem onSelect={onInteract}><Heart size={14} aria-hidden />{t('interact')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <button type="button" className={`fob-action ${styles.icon}`} aria-label={t('close')} onClick={onClose}><X size={16} aria-hidden /></button>
    </div>
    <div className={styles.messages}>
      <div ref={transcript} className={styles.transcript} role={historyOpen ? 'region' : 'log'} aria-label={t(historyOpen ? 'history' : 'conversation')} aria-live="off" aria-busy={pending || undefined} onScroll={event => { const node = event.currentTarget; if (node.hasAttribute('data-bubble-opening')) return; const near = node.scrollHeight - node.scrollTop - node.clientHeight < 50; follow.current = near; setLatest(!near); }}>
        {historyOpen ? <div className={`${styles.answer} ${styles.history}`}>
          <div className={styles.historyHeader}><button type="button" className={`fob-action ${styles.icon}`} aria-label={t('back')} onClick={() => setHistory({ key, open: false, filter: '' })}><ArrowLeft size={14} aria-hidden /></button><h3>{t('history')}</h3></div>
          <input className={styles.search} type="search" value={filter} aria-label={t('search')} placeholder={t('search')} onChange={event => setHistory({ key, open: true, filter: event.target.value })} />
          {chat.historyLoading ? <p className={styles.historyEmpty} role="status">{t('loading')}</p> : chat.historyError ? <AppAlert tone="error" title={t(assistantErrorKey(chat.historyError))} action={<Button variant="ghost" size="sm" onClick={() => void chat.refresh()}>{t('retry')}</Button>} /> : results.length ? <ul className={styles.historyList}>{results.map(item => <li key={item.id}>
            <button type="button" className={`fob-action ${styles.historyItem}`} aria-current={chat.conversation?.id === item.id ? 'true' : undefined} disabled={removing} onClick={() => { follow.current = true; setLatest(false); setHistory({ key, open: false, filter: '' }); void chat.selectConversation(item.id); }}><span>{item.title || t('untitled')}</span><time dateTime={item.updatedAt}>{formatRelativeTime(Date.parse(item.updatedAt), locale)}</time></button>
            <button type="button" className={`fob-action ${styles.icon}`} aria-label={`${t('remove')} · ${item.title || t('untitled')}`} disabled={removing} onClick={() => setDeletion({ key, id: item.id, pending: false })}><Trash size={12} aria-hidden /></button>
          </li>)}</ul> : <p className={styles.historyEmpty}>{t(chat.conversations.length ? 'noMatchingHistory' : 'emptyHistory')}</p>}
          {removeId && <div className={styles.confirmation}><AppAlert tone="warning" title={t('removeConfirm')} description={t('removeDescription')} action={<><Button variant="ghost" size="sm" disabled={removing} onClick={() => setDeletion({ key, id: null, pending: false })}>{t('cancel')}</Button><Button variant="ghost" size="sm" loading={removing} onClick={() => void remove()}>{t('remove')}</Button></>} /></div>}
        </div> : <>
          {turns.map((turn, index) => <article className={styles.turn} key={turn.id}>
            {turn.status !== 'unavailable' && <div className={styles.question} data-companion-bubble="question">{turn.question}</div>}
            <div className={styles.answer} data-companion-bubble="answer" data-tail={index === turns.length - 1 || undefined} data-has-actions={turn.status !== 'unavailable' && turn.status !== 'running' || undefined}>
              {index === turns.length - 1 && <span className={styles.tail} aria-hidden="true" data-companion-tail />}
              <div className={styles.answerBody}>
              {turn.status === 'unavailable' ? <p className={styles.muted}>{t('unavailable')}</p> : turn.answer ? <CompanionChatAnswer text={turn.answer} sources={turn.sources} onSource={onSource} unavailableLabel={t('sourceUnavailable')} /> : <p className={turn.status === 'running' ? styles.thinking : styles.muted} role="status">{t(turn.status === 'running' ? 'thinking' : turn.status === 'cancelled' ? 'stopped' : 'failed')}{turn.status === 'running' && <span className={styles.dots} aria-hidden><i /><i /><i /></span>}</p>}
              {turn.status === 'cancelled' && turn.answer && <p className={styles.muted}>{t('stopped')}</p>}
              {turn.status === 'failed' && <div className={styles.notice}><AppAlert tone="error" title={t(assistantErrorKey(turn.errorCode ?? 'failed'))} /></div>}
              </div>
              {turn.status !== 'unavailable' && <><SourceLinks turn={turn} onSource={onSource} />{turn.status !== 'running' && <AnswerActions turn={turn} chat={chat} />}</>}
            </div>
          </article>)}
          {!turns.length && (pending ? <p className={styles.loading} role="status">{t('loading')}</p> : <div className={styles.answer} data-companion-bubble="answer" data-tail><span className={styles.tail} aria-hidden="true" data-companion-tail /><p>{!available ? stateLabel : t('greeting')}</p>{context.status === 'signed-out' && <a className={styles.source} href="/auth">{t('signIn')}</a>}</div>)}
          {available && !chat.settingsLoading && !chat.ready && <div className={styles.notice}><AppAlert tone="info" title={t(context.canConfigureAI ? 'configuration' : 'configurationManaged')} action={context.canConfigureAI ? <Button variant="ghost" size="sm" onClick={onSettings}>{t('settings')}</Button> : undefined} /></div>}
          {available && chat.errorCode && !(last?.status === 'failed' && last.errorCode === chat.errorCode) && <div className={styles.notice}><AppAlert tone="error" title={t(assistantErrorKey(chat.errorCode))} action={<Button variant="ghost" size="sm" onClick={() => void chat.refresh()}>{t('retry')}</Button>} /></div>}
          {chat.truncated && turns.length > 0 && <p className={styles.muted}>{t('truncated')}</p>}
        </>}
      </div>
      {latest && !historyOpen && <Tooltip><TooltipTrigger asChild><button type="button" className={`fob-action ${styles.latest}`} aria-label={t('latest')} onClick={() => { follow.current = true; setLatest(false); transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }}><ArrowDown size={14} aria-hidden /></button></TooltipTrigger><TooltipContent>{t('latest')}</TooltipContent></Tooltip>}
    </div>
    {!historyOpen && <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send(); }}>
      <textarea ref={input} value={text} rows={1} maxLength={8000} readOnly={busy || !available} aria-label={t('placeholder')} placeholder={t('placeholder')} onChange={event => setDraft({ key, text: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} />
      <Tooltip><TooltipTrigger asChild>{busy ? <button type="button" className={`fob-action ${styles.send}`} aria-label={t('stop')} onClick={() => void chat.stop()}><Stop size={12} aria-hidden /></button> : <button type="submit" className={`fob-action ${styles.send}`} aria-label={t('send')} disabled={!available || !chat.ready || !text.trim()}><ArrowUp size={17} aria-hidden /></button>}</TooltipTrigger><TooltipContent>{t(busy ? 'stop' : 'send')}</TooltipContent></Tooltip>
    </form>}
    <span className="sr-only" role="status" aria-live="polite">{busy ? t('thinking') : last?.status === 'done' ? t('answered') : ''}</span>
  </div>;
}
