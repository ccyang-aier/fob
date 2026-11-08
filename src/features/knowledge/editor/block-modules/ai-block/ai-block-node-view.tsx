'use client';

import { useEffect, useRef, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { collectSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import { ArrowUp, ArrowCounterClockwise, Check, GenerateStar, SelectionEdit, Stop } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePageVisible } from '@/lib/page-visibility';
import { useAiStreamingTask } from '../../../ai/use-ai-streaming-task';
import { acceptAiBlock, aiBlockHasContent, aiDraftMarkdown, selectAiDraft, undoAiBlock } from './ai-block-decisions';
import { knowledgeMessages } from './ai-block-node-view.messages';
import styles from './ai-block.module.css';

export function AiBlockNodeView({ scope, userId, ...props }: NodeViewProps & { scope?: PageScope; userId?: string }) {
  const { t } = useTranslation(knowledgeMessages);
  const visible = usePageVisible();
  const { node, editor, updateAttributes, HTMLAttributes, getPos } = props;
  const blockId = String(node.attrs.blockId || '');
  const taskId = node.attrs.taskId ? String(node.attrs.taskId) : null;
  const task = useAiStreamingTask(scope?.knowledgeBaseId ?? '', scope ? taskId : null);
  const [draft, setDraft] = useState(String(node.attrs.prompt || ''));
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false), input = useRef<HTMLTextAreaElement>(null), completionTask = useRef<string | null>(null), selectedTask = useRef<string | null>(null);
  const mounted = useRef(true);
  const hasContent = aiBlockHasContent(node);
  const status = task.snapshot?.status;
  const running = busy === 'start' || status === 'running' || task.loading;
  const preview = running ? task.snapshot?.preview ?? '' : '';
  const filled = hasContent || Boolean(preview.trim());
  const review = filled && !running && !refining;
  const canEdit = Boolean(scope && editor.isEditable);
  const canStop = !userId || !task.snapshot || task.snapshot.initiatedBy === userId;
  const suggestionIds = collectSuggestions(node).map(suggestion => suggestion.suggestionId);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!taskId && !hasContent) input.current?.focus({ preventScroll: true });
  }, [taskId, hasContent]);
  useEffect(() => {
    if (!visible || !hasContent || status !== 'done' || !taskId || completionTask.current !== taskId || selectedTask.current === taskId) return;
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (typeof pos !== 'number') return;
      const host = editor.view.nodeDOM(pos), active = document.activeElement;
      // Clicking Generate moves focus off the input. Body focus after the form
      // unmounts is also expected; another focused control must keep its focus.
      if (active && active !== document.body && !(host instanceof Element && host.contains(active))) return;
      if (selectAiDraft(editor, blockId)) selectedTask.current = taskId;
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, hasContent, status, taskId, editor, getPos, blockId]);

  async function generate() {
    if (!scope || !canEdit || pending.current || !draft.trim() || !blockId) return;
    pending.current = true; setBusy('start'); setError(null);
    const instructions = draft.trim();
    try {
      const previous = hasContent ? aiDraftMarkdown(node).slice(0, 11000) : '';
      const prompt = previous
        ? `${t('revisionInstructions')}\n${instructions}\n\n${t('previousDraft')}\n${previous}`.slice(0, 20000)
        : instructions;
      const snapshot = await task.start({ pageId: scope.pageId, insideBlockId: blockId, afterBlockId: null, prompt, tier: node.attrs.tier === 'smart' ? 'smart' : 'fast', replaceInside: true });
      if (mounted.current) { completionTask.current = snapshot.taskId; updateAttributes({ taskId: snapshot.taskId, prompt: instructions }); setRefining(false); }
    } catch { if (mounted.current) setError(t('unableToStartAiTask')); }
    finally { pending.current = false; if (mounted.current) setBusy(null); }
  }
  async function stop() {
    if (pending.current || !canStop) return;
    pending.current = true; setBusy('stop'); setError(null);
    try { await task.cancel(); }
    catch { if (mounted.current) setError(t('unableToCancel')); }
    finally { pending.current = false; if (mounted.current) setBusy(null); }
  }
  function undo() {
    if (undoAiBlock(editor, blockId)) { task.reset(); setRefining(false); setError(null); }
  }
  function revise() { setRefining(true); setDraft(''); requestAnimationFrame(() => input.current?.focus()); }
  const failure = error || (status === 'failed' ? t('generationFailedRetryIsAvailable') : null);

  return <NodeViewWrapper as="section" {...HTMLAttributes} data-fob-node="ai-block" data-block-id={blockId}
    data-ai-stage={review ? 'review' : running ? filled ? 'generating' : 'thinking' : 'empty'} data-filled={filled || undefined} aria-busy={running} className={styles.root}>
    {!filled && <div className={styles.emptyStar} contentEditable={false} aria-hidden><GenerateStar size={28} /></div>}
    <NodeViewContent className={styles.content} contentEditable={running ? false : undefined} data-empty={!hasContent || undefined} />
    {preview && <div className={styles.preview} contentEditable={false} aria-hidden>{preview}</div>}
    {canEdit && <div className={styles.floating} contentEditable={false}>
      {review ? <div className={styles.decisions} role="toolbar" aria-label={t('reviewGeneration')}>
        <button type="button" className={`fob-action ${styles.decision}`} data-surface="plain" disabled={!suggestionIds.length} onClick={undo}><ArrowCounterClockwise size={18} aria-hidden />{t('undoGeneration')}</button>
        <button type="button" className={`fob-action ${styles.decision}`} data-surface="plain" onClick={revise}><SelectionEdit size={18} aria-hidden />{t('requestChanges')}</button>
        <button type="button" className={styles.accept} onClick={() => acceptAiBlock(editor, blockId)}><Check size={18} aria-hidden />{t('adopt')}</button>
      </div> : <form className={styles.promptBar} onSubmit={event => { event.preventDefault(); void generate(); }}>
        <textarea ref={input} aria-label={t('aiTaskInstructions')} placeholder={running ? t('processing') : refining ? t('revisionPlaceholder') : t('describeWhatYouWantAiToDo')}
          value={running ? '' : draft} readOnly={running} rows={1} maxLength={8000}
          onChange={event => { setDraft(event.target.value); event.target.style.height = '32px'; event.target.style.height = `${Math.min(96, event.target.scrollHeight)}px`; }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!running) void generate(); } if (event.key === 'Escape' && refining) setRefining(false); }} />
        <Tooltip><TooltipTrigger asChild>{running ? <button type="button" className={styles.roundAction} aria-label={t('stop')} disabled={Boolean(busy) || !canStop || !task.snapshot} onClick={() => void stop()}><Stop size={16} aria-hidden /></button>
          : <button type="submit" className={styles.roundAction} aria-label={t('generate')} disabled={!draft.trim() || Boolean(busy)}><ArrowUp size={24} aria-hidden /></button>}</TooltipTrigger><TooltipContent>{running ? t('stop') : t('generate')}</TooltipContent></Tooltip>
      </form>}
    </div>}
    {!canEdit && !filled && <p className={styles.notice} contentEditable={false}>{scope ? t('readOnlyGeneration') : t('aiTasksRequireAConnectedTeamKnowledgeBase')}</p>}
    {failure && <p className={styles.error} role="alert" contentEditable={false}>{failure}</p>}
    {task.error && taskId && !running && <p className={styles.error} role="status" contentEditable={false}>{t('previousTaskUnavailable')}</p>}
  </NodeViewWrapper>;
}
