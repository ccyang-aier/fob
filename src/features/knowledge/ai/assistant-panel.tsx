'use client';
import { useEffect, useRef, useState } from 'react';
import type { PageScope, AssistantSource } from '@fob/shared/knowledge/contracts';
import { GenerateStar as Sparkle, X, Plus, ClockCounterClockwise, GearSix, PaperPlaneTilt, Stop, Copy, ArrowDown, FileText, Trash } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { DocumentSidebar } from '../editor/components/document-sidebar';
import { requestOpenPageBlock } from '../editor/open-target';
import { useAssistant } from './use-assistant';
import { assistantMessages } from './assistant.messages';
import { AssistantSettingsDialog } from './assistant-settings';
import { AssistantAnswer } from './assistant-answer';
import { assistantErrorKey } from './errors';
import styles from './assistant.module.css';

export function AssistantEntry({ open, onClick }: { open: boolean; onClick(): void }) {
  const { t } = useTranslation(assistantMessages);
  return <Tooltip><TooltipTrigger asChild><button type="button" data-surface="plain" data-variant="hover" className={`fob-action ${styles.entry}`} aria-label={t('open')} aria-expanded={open} onClick={onClick}><Sparkle size={16} aria-hidden /><span>AI</span></button></TooltipTrigger><TooltipContent>{t('open')}</TooltipContent></Tooltip>;
}

export function AssistantPanel({ scope, userId, editable, selection, onClearSelection, onClose }: { scope: PageScope; userId: string; editable: boolean; selection: string; onClearSelection(): void; onClose(): void }) {
  const { t } = useTranslation(assistantMessages), { notify } = useAppAlert(), assistant = useAssistant(scope, userId);
  const [prompt, setPrompt] = useState(''), [mode, setMode] = useState<'document' | 'knowledgeBase'>('document'), [tier, setTier] = useState<'fast' | 'smart'>('fast');
  const [settingsOpen, setSettingsOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [historyFilter, setHistoryFilter] = useState(''), [applying, setApplying] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null), messages = useRef<HTMLDivElement>(null), follow = useRef(true);
  const active = useRef(false), applyingRequest = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const conversation = assistant.conversation, turns = conversation?.turns ?? [];
  const lastAnswer = turns.at(-1)?.answer;
  useEffect(() => { if (follow.current) messages.current?.scrollTo({ top: messages.current.scrollHeight }); }, [lastAnswer, turns.length]);
  useEffect(() => { if (selection) textarea.current?.focus(); }, [selection]);
  const onSource = (source: AssistantSource) => requestOpenPageBlock({ knowledgeBaseId: scope.knowledgeBaseId, pageId: source.pageId, blockId: source.blockId });
  async function send(value = prompt) { if (!value.trim() || assistant.busy || applyingRequest.current) return; setPrompt(''); setHistoryOpen(false); follow.current = true; const question = selection ? `${value.trim()}\n\n${selection}`.slice(0, 8000) : value.trim(); onClearSelection(); await assistant.send(question, mode, tier); }
  async function apply(turnId: string) {
    if (applyingRequest.current || assistant.busy) return;
    applyingRequest.current = true; setApplying(turnId);
    try { await assistant.apply(turnId); if (active.current) { notify('success', t('inserted')); onClose(); } }
    catch { if (active.current) notify('error', t('failed')); }
    finally { applyingRequest.current = false; if (active.current) setApplying(null); }
  }
  const tools = [
    { key: 'newChat', Icon: Plus }, { key: 'history', Icon: ClockCounterClockwise },
    { key: 'settings', Icon: GearSix }, { key: 'close', Icon: X },
  ] as const;
  function toolAction(key: typeof tools[number]['key']) {
    if (key === 'newChat') { assistant.select(null); setHistoryOpen(false); setPrompt(''); onClearSelection(); textarea.current?.focus(); }
    else if (key === 'history') setHistoryOpen(value => !value);
    else if (key === 'settings') setSettingsOpen(true);
    else onClose();
  }
  return <DocumentSidebar panel="assistant" defaultWidth={400} className={styles.rail} aria-label={t('title')}>
    <section className={styles.panel}>
      <header className={styles.header}><Sparkle size={16} aria-hidden /><h2>{t('title')}</h2><div>{tools.map(({ key, Icon }) => <Tooltip key={key}><TooltipTrigger asChild><button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" aria-label={t(key)} disabled={(assistant.busy || Boolean(applying)) && key !== 'close'} onClick={() => toolAction(key)}><Icon size={16} aria-hidden /></button></TooltipTrigger><TooltipContent>{t(key)}</TooltipContent></Tooltip>)}</div></header>
      {historyOpen ? <div className={styles.history}><input type="search" aria-label={t('history')} placeholder={t('history')} value={historyFilter} onChange={event => setHistoryFilter(event.target.value)} />{assistant.list.isPending ? <p>{t('loading')}</p> : assistant.list.isError ? <AppAlert tone="error" title={t('failed')} /> : assistant.list.data?.length ? assistant.list.data.filter(item => item.title.toLocaleLowerCase().includes(historyFilter.toLocaleLowerCase())).map(item => <div key={item.id}><button type="button" className="fob-action" onClick={() => { assistant.select(item.id); setHistoryOpen(false); }}>{item.title || t('unknown')}</button><button type="button" className={`fob-action ${styles.iconButton}`} aria-label={t('remove')} onClick={() => { if (window.confirm(t('removeConfirm'))) void assistant.remove(item.id).catch(() => notify('error', t('failed'))); }}><Trash size={14} aria-hidden /></button></div>) : <p>{t('emptyHistory')}</p>}</div> : <>
        <div className={styles.messages} ref={messages} onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60; }}>
          {assistant.thread.isPending && assistant.conversationId ? <p role="status">{t('loading')}</p> : null}
          {!turns.length && !(assistant.thread.isPending && assistant.conversationId) && <div className={styles.welcome}><span><Sparkle size={28} aria-hidden /></span><h3>{t('intro')}</h3><p>{t('subtitle')}</p><div>{(['summary', 'actions'] as const).map(key => <button type="button" className="fob-action" key={key} disabled={assistant.busy || Boolean(applying) || !assistant.settings.data?.ready} onClick={() => void send(t(key === 'summary' ? 'summaryPrompt' : 'actionsPrompt'))}>{t(key)}<ArrowDown size={14} aria-hidden /></button>)}</div></div>}
          {turns.map(turn => <article key={turn.id} className={styles.turn}>
            {turn.status === 'unavailable' ? <p className={styles.muted}>{t('unavailable')}</p> : <><div className={styles.question}>{turn.question}</div><div className={styles.answer}>
              {Boolean(turn.toolSteps?.length) && <details className={styles.toolSteps} open={turn.status === 'running'}><summary>{t('research')} · {turn.toolSteps!.length}</summary>{turn.toolSteps!.map(step => <div key={step.id} data-status={step.status}><span>{t(step.name === 'search' ? 'searchTool' : step.name === 'read_page' ? 'readTool' : step.name === 'query_database' ? 'databaseTool' : step.name === 'list_pages' ? 'listTool' : step.name === 'get_backlinks' ? 'backlinksTool' : 'research')}</span><small>{step.summary}</small></div>)}</details>}
              {turn.answer ? <AssistantAnswer text={turn.answer} sources={turn.sources} onSource={onSource} /> : <p className={styles.thinking} role="status">{t(turn.status === 'running' ? 'thinking' : turn.status === 'cancelled' ? 'cancelled' : 'failed')}</p>}
              {turn.sources.length > 0 && <details className={styles.sources}><summary>{t('sources')} · {turn.sources.length}</summary>{turn.sources.map(source => <button type="button" className="fob-action" key={source.id} onClick={() => onSource(source)} title={source.excerpt}><FileText size={14} aria-hidden /><span>{source.id}. {source.title}</span></button>)}</details>}
              {turn.status === 'cancelled' && turn.answer && <p className={styles.muted}>{t('cancelled')}</p>}
              {turn.status === 'failed' && <p role="alert" className={styles.error}>{t(assistantErrorKey(turn.errorCode ?? 'failed'))}</p>}
              {turn.model && <p className={styles.usage}>{turn.model}{turn.outputTokens !== null ? ` · ${turn.outputTokens} tokens` : ''}</p>}
              {turn.status !== 'running' && <div className={styles.answerActions}>{turn.answer && <button type="button" className="fob-action" onClick={() => void navigator.clipboard.writeText(turn.answer.replace(/\[([^\]]+)\]\(fob-source:\d+\)/g, '$1')).then(() => notify('success', t('copied')), () => notify('error', t('failed')))}><Copy size={14} aria-hidden />{t('copy')}</button>}<button type="button" className="fob-action" disabled={assistant.busy || Boolean(applying)} onClick={() => void assistant.send(turn.question, turn.mode, tier)}>{t('retry')}</button>{editable && turn.status === 'done' && <Button variant="ghost" size="sm" loading={applying === turn.id} disabled={assistant.busy || Boolean(turn.appliedPageId) || Boolean(applying)} onClick={() => void apply(turn.id)}>{t(turn.appliedPageId ? 'applied' : 'insert')}</Button>}</div>}
            </div></>}
          </article>)}
        </div>
        <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send(); }}>
          {assistant.error && <AppAlert tone="error" title={t(assistantErrorKey(assistant.error))} />}{assistant.thread.isError && !assistant.busy && <AppAlert tone="error" title={t('failed')} action={<Button variant="ghost" size="sm" onClick={() => assistant.select(null)}>{t('newChat')}</Button>} />}
          {assistant.settings.isError ? <AppAlert tone="error" title={t('failed')} action={<Button variant="ghost" size="sm" onClick={() => void assistant.settings.refetch()}>{t('retry')}</Button>} /> : assistant.settings.data && !assistant.settings.data.ready && <button type="button" className={`fob-action ${styles.setup}`} onClick={() => setSettingsOpen(true)}><GearSix size={14} aria-hidden />{t('configuration')}</button>}
          {selection && <div className={styles.selection}><span>{t('selected')}</span><button type="button" className={`fob-action ${styles.iconButton}`} aria-label={t('clearSelection')} onClick={onClearSelection}><X size={14} /></button><p>{selection}</p><div><button type="button" className="fob-action" onClick={() => setPrompt(t('improvePrompt'))}>{t('improve')}</button><button type="button" className="fob-action" onClick={() => setPrompt(t('translatePrompt'))}>{t('translate')}</button></div></div>}
          <div className={styles.inputBox}><textarea ref={textarea} aria-label={t('placeholder')} placeholder={t('placeholder')} maxLength={selection ? Math.max(1,7998-selection.length) : 8000} rows={3} value={prompt} disabled={assistant.busy || Boolean(applying)} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            <div className={styles.composerTools}><select aria-label={t('scope')} value={mode} disabled={assistant.busy || Boolean(applying)} onChange={event => setMode(event.target.value as typeof mode)}><option value="document">{t('document')}</option><option value="knowledgeBase">{t('knowledgeBase')}</option></select><select aria-label={t('tier')} value={tier} disabled={assistant.busy || Boolean(applying)} onChange={event => setTier(event.target.value as typeof tier)}><option value="fast">{t('fast')}</option><option value="smart">{t('smart')}</option></select><span />{assistant.busy ? <button type="button" className={`fob-action ${styles.send}`} aria-label={t('stop')} onClick={() => void assistant.stop()}><Stop size={16} aria-hidden /></button> : <button type="submit" className={`fob-action ${styles.send}`} aria-label={t('send')} disabled={Boolean(applying) || !prompt.trim() || !assistant.settings.data?.ready}><PaperPlaneTilt size={16} aria-hidden /></button>}</div>
          </div><p className={styles.footnote}>{t(assistant.truncated ? 'truncated' : 'review')}</p>
        </form>
      </>}
    </section>
    {settingsOpen && assistant.settings.data && <AssistantSettingsDialog knowledgeBaseId={scope.knowledgeBaseId} value={assistant.settings.data} onSaved={() => { void assistant.refresh(); }} onClose={() => setSettingsOpen(false)} />}
  </DocumentSidebar>;
}
