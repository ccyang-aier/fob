'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantSource, AssistantTurn, PageScope } from '@fob/shared/knowledge/contracts';
import { ArrowDown, ArrowRight, Copy, FileText, GenerateStar, GearSix, Plus, X, ClockCounterClockwise } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { requestOpenPageBlock } from '../editor/open-target';
import { AssistantWindow } from './assistant-window';
import { AssistantComposer, type AssistantDraft } from './assistant-composer';
import { AssistantHistory } from './assistant-history';
import { AssistantSettingsDialog } from './assistant-settings';
import { AssistantAnswer } from './assistant-answer';
import { assistantMessages } from './assistant.messages';
import { assistantErrorKey } from './errors';
import { useAssistant } from './use-assistant';
import styles from './assistant.module.css';

function AssistantResearch({ steps }: { steps: AssistantTurn['toolSteps'] }) {
  const { t } = useTranslation(assistantMessages);
  if (!steps?.length) return null;
  return <details className={styles.toolSteps}><summary>{t('research')} · {steps.length}</summary>{steps.map(step => <div key={step.id} data-status={step.status}><span>{t(step.name === 'search' ? 'searchTool' : step.name === 'read_page' ? 'readTool' : step.name === 'query_database' ? 'databaseTool' : step.name === 'list_pages' ? 'listTool' : step.name === 'get_backlinks' ? 'backlinksTool' : 'research')}</span><small>{step.summary}</small></div>)}</details>;
}

export function AssistantPanel({ scope, userId, editable, selection, documentTitle, onClearSelection, onClose }: {
  scope: PageScope; userId: string; editable: boolean; selection: string; documentTitle: string; onClearSelection(): void; onClose(): void;
}) {
  const { t, locale } = useTranslation(assistantMessages), { notify } = useAppAlert(), assistant = useAssistant(scope, userId);
  const time = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), [locale]);
  const [draft, setDraft] = useState<AssistantDraft>({ prompt: '', mode: 'document', tier: 'fast', model: null });
  const [settingsOpen, setSettingsOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [applying, setApplying] = useState<string | null>(null), [showLatest, setShowLatest] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null), messages = useRef<HTMLDivElement>(null), follow = useRef(true);
  const active = useRef(false), applyingRequest = useRef(false), sending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const turns = assistant.conversation?.turns ?? [], configured = assistant.settings.data;
  const selectedConnection = draft.model ? configured?.connections?.find(connection => connection.id === draft.model!.connectionId) : undefined;
  const modelReady = draft.model ? Boolean(selectedConnection?.models.some(model => model.id === draft.model!.modelId)) : configured?.platformModels ? Boolean(configured.selections?.[draft.tier] || configured.platformModels[draft.tier]) : Boolean(configured?.ready);
  const defaultSelection = configured?.selections?.[draft.tier];
  const defaultName = defaultSelection ? configured?.connections?.find(connection => connection.id === defaultSelection.connectionId)?.models.find(model => model.id === defaultSelection.modelId)?.name || defaultSelection.modelId : configured?.platformModels?.[draft.tier] ?? configured?.model;
  const lastAnswer = turns.at(-1)?.answer;
  useEffect(() => {
    if (!follow.current || historyOpen) return;
    const frame = requestAnimationFrame(() => messages.current?.scrollTo({ top: messages.current.scrollHeight }));
    return () => cancelAnimationFrame(frame);
  }, [lastAnswer, turns.length, historyOpen]);
  useEffect(() => {
    if (historyOpen) return;
    const frame = requestAnimationFrame(() => textarea.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [historyOpen, selection]);
  const onSource = (source: AssistantSource) => requestOpenPageBlock({ knowledgeBaseId: scope.knowledgeBaseId, pageId: source.pageId, blockId: source.blockId });
  function updateDraft(patch: Partial<AssistantDraft>) { setDraft(current => ({ ...current, ...patch })); }
  async function send(value = draft.prompt) {
    if (!value.trim() || !modelReady || assistant.busy || applyingRequest.current || sending.current) return;
    sending.current = true; follow.current = true; setShowLatest(false); setHistoryOpen(false);
    const question = selection ? `${value.trim()}\n\n${selection}`.slice(0, 8000) : value.trim();
    try {
      await assistant.send(question, draft.mode, draft.tier, draft.model, () => {
        if (!active.current) return;
        // Keep the typed draft if a transport/configuration error happens before acceptance.
        setDraft(current => current.prompt === draft.prompt ? { ...current, prompt: '' } : current);
        onClearSelection();
      });
    } finally { sending.current = false; }
  }
  async function apply(turnId: string) {
    if (applyingRequest.current || assistant.busy) return;
    applyingRequest.current = true; setApplying(turnId);
    try { await assistant.apply(turnId); if (active.current) { notify('success', t('inserted')); onClose(); } }
    catch { if (active.current) notify('error', t('failed')); }
    finally { applyingRequest.current = false; if (active.current) setApplying(null); }
  }
  const tools = [{ key: 'newChat', Icon: Plus }, { key: 'history', Icon: ClockCounterClockwise }, { key: 'settings', Icon: GearSix }, { key: 'close', Icon: X }] as const;
  function toolAction(key: typeof tools[number]['key']) {
    if (key === 'newChat') { assistant.select(null); updateDraft({ prompt: '' }); onClearSelection(); setHistoryOpen(false); follow.current = true; setShowLatest(false); textarea.current?.focus(); }
    else if (key === 'history') setHistoryOpen(value => !value);
    else if (key === 'settings') setSettingsOpen(true);
    else onClose();
  }
  const notice = <>
    {assistant.error && <AppAlert tone="error" title={t(assistantErrorKey(assistant.error))} />}
    {assistant.thread.isError && !assistant.busy && <AppAlert tone="error" title={t('failed')} action={<Button type="button" variant="ghost" size="sm" onClick={() => assistant.select(null)}>{t('newChat')}</Button>} />}
    {assistant.settings.isError ? <AppAlert tone="error" title={t('failed')} action={<Button type="button" variant="ghost" size="sm" onClick={() => void assistant.settings.refetch()}>{t('retry')}</Button>} /> : configured && !modelReady && <button type="button" className={`fob-action ${styles.setup}`} onClick={() => setSettingsOpen(true)}><GearSix size={14} aria-hidden />{t('configuration')}</button>}
  </>;
  return <><AssistantWindow label={t('title')} moveLabel={t('moveWindow')} moveHint={t('moveWindowHint')} onClose={onClose} headerClassName={styles.header}
    header={<><GenerateStar size={16} aria-hidden /><h2>{t('title')}</h2><span className={styles.documentBadge} title={documentTitle}><FileText size={12} aria-hidden /><span>{documentTitle || t('document')}</span></span><div>{tools.map(({ key, Icon }) => <Tooltip key={key}><TooltipTrigger asChild><button type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" aria-label={t(key)} aria-pressed={key === 'history' ? historyOpen : undefined} disabled={(assistant.busy || Boolean(applying)) && key !== 'close'} onClick={() => toolAction(key)}><Icon size={14} aria-hidden /></button></TooltipTrigger><TooltipContent>{t(key)}</TooltipContent></Tooltip>)}</div></>}>
    <section className={styles.panel}>
      {historyOpen ? <AssistantHistory items={assistant.list.data ?? []} loading={assistant.list.isPending} failed={assistant.list.isError} selectedId={assistant.conversationId} onSelect={id => { assistant.select(id); setHistoryOpen(false); follow.current = true; setShowLatest(false); }} onRemove={assistant.remove} onRetry={() => void assistant.list.refetch()} /> : <>
        <div className={styles.messagesWrap}>
          <div className={styles.messages} ref={messages} role="log" aria-label={t('conversation')} aria-live="off" data-empty={!turns.length || undefined} onScroll={event => {
            const node = event.currentTarget, nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
            follow.current = nearBottom; setShowLatest(!nearBottom);
          }}>
            {assistant.thread.isPending && assistant.conversationId ? <p className={styles.thinking} role="status">{t('loading')}</p> : null}
            {!turns.length && !(assistant.thread.isPending && assistant.conversationId) && <div className={styles.welcome}>
              <p className={styles.suggestionHeading}>{t('suggestedQuestions')}</p>
              <div className={styles.suggestions}>{([
                ['summaryQuestion', 'summaryPrompt'], ['actionsQuestion', 'actionsPrompt'],
                ['outlineQuestion', 'outlinePrompt'], ['factsQuestion', 'factsPrompt'],
              ] as const).map(([label, prompt]) => <button type="button" className="fob-action" key={label} disabled={assistant.busy || Boolean(applying) || !modelReady} onClick={() => void send(t(prompt))}><ArrowRight size={14} aria-hidden /><span>{t(label)}</span></button>)}</div>
            </div>}
            {turns.map(turn => <article key={turn.id} className={styles.turn}>
              {turn.status === 'unavailable' ? <p className={styles.muted}>{t('unavailable')}</p> : <>
                <time className={styles.turnTime} dateTime={turn.createdAt}>{time.format(new Date(turn.createdAt))}</time>
                <div className={styles.question}>{turn.question}</div>
                <div className={styles.answer}>
                  {turn.status === 'running' && <><div className={styles.answerLabel}><GenerateStar size={14} aria-hidden /><span>{t('title')}</span><span className={styles.activityDots} aria-hidden><i /><i /><i /></span></div><AssistantResearch steps={turn.toolSteps} /></>}
                  {turn.answer ? <AssistantAnswer text={turn.answer} sources={turn.sources} onSource={onSource} /> : <p className={styles.thinking} role="status">{t(turn.status === 'running' ? 'thinking' : turn.status === 'cancelled' ? 'cancelled' : 'failed')}</p>}
                  {turn.sources.length > 0 && <details className={styles.sources}><summary>{t('sources')} · {turn.sources.length}</summary>{turn.sources.map(source => <button type="button" className="fob-action" key={source.id} onClick={() => onSource(source)} title={source.excerpt}><FileText size={12} aria-hidden /><span>{source.id}. {source.title}</span></button>)}</details>}
                  {turn.status === 'cancelled' && turn.answer && <p className={styles.muted}>{t('cancelled')}</p>}
                  {turn.status === 'failed' && <p role="alert" className={styles.error}>{t(assistantErrorKey(turn.errorCode ?? 'failed'))}</p>}
                  {turn.status !== 'running' && <AssistantResearch steps={turn.toolSteps} />}
                  {turn.status !== 'running' && <div className={styles.answerActions}>
                    {turn.answer && <Tooltip><TooltipTrigger asChild><button type="button" className="fob-action" aria-label={t('copy')} onClick={() => void navigator.clipboard.writeText(turn.answer.replace(/\[([^\]]+)\]\(fob-source:\d+\)/g, '$1')).then(() => notify('success', t('copied')), () => notify('error', t('failed')))}><Copy size={14} aria-hidden /></button></TooltipTrigger><TooltipContent>{t('copy')}</TooltipContent></Tooltip>}
                    <button type="button" className="fob-action" disabled={assistant.busy || Boolean(applying) || !modelReady} onClick={() => void assistant.send(turn.question, turn.mode, draft.tier, draft.model)}>{t('retry')}</button>
                    {editable && turn.status === 'done' && <Button type="button" variant="ghost" size="sm" loading={applying === turn.id} disabled={assistant.busy || Boolean(turn.appliedPageId) || Boolean(applying)} onClick={() => void apply(turn.id)}>{t(turn.appliedPageId ? 'applied' : 'insert')}</Button>}
                    {turn.model && <span className={styles.usage} title={turn.outputTokens !== null ? `${turn.model} · ${turn.outputTokens} tokens` : turn.model}>{turn.model}</span>}
                  </div>}
                </div>
              </>}
            </article>)}
          </div>
          {showLatest && <button type="button" className={`fob-action ${styles.jumpLatest}`} onClick={() => { follow.current = true; setShowLatest(false); messages.current?.scrollTo({ top: messages.current.scrollHeight }); }}><ArrowDown size={12} aria-hidden />{t('jumpLatest')}</button>}
        </div>
        <AssistantComposer draft={draft} onChange={updateDraft} settings={configured} defaultModel={defaultName} selection={selection} onClearSelection={onClearSelection} busy={assistant.busy} applying={Boolean(applying)} ready={modelReady} truncated={assistant.truncated} notice={notice} inputRef={textarea} onSend={() => void send()} onStop={() => void assistant.stop()} onManage={() => setSettingsOpen(true)} />
      </>}
    </section>
  </AssistantWindow>
    {settingsOpen && configured && <AssistantSettingsDialog knowledgeBaseId={scope.knowledgeBaseId} value={configured} onSaved={() => { void assistant.refresh(); }} onClose={() => setSettingsOpen(false)} />}
  </>;
}
