'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './ai-block-node-view.messages';
import { useState } from 'react';
import { CheckCircle, CircleNotch, Pause, Play, Sparkle, Trash } from '@/components/icons';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { useAiStreamingTask } from '../../../ai/use-ai-streaming-task';
import styles from './ai-block.module.css';

export function AiBlockNodeView({ scope, ...props }: NodeViewProps & { scope?: PageScope }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { node, editor, updateAttributes, HTMLAttributes } = props;
  const [error, setError] = useState('');
  const prompt = String(node.attrs.prompt || '');
  const blockId = String(node.attrs.blockId || '');
  const taskId = node.attrs.taskId ? String(node.attrs.taskId) : null;
  return (
    <NodeViewWrapper
      as="section"
      {...HTMLAttributes}
      data-fob-node="ai-block"
      data-block-id={node.attrs.blockId}
      className={styles.root}
    >
      <div className={styles.header} contentEditable={false}>
        <span className={styles.title}>
          <span className={styles.sparkle}>
            <Sparkle aria-hidden size={16} />
          </span>{' '}
          {knowledgeT('aiTaskBlock')}
        </span>
        <span className={styles.subtle}>{knowledgeT('generatedContentAppearsAsSuggestions')}</span>
      </div>
      <div className={styles.controls} contentEditable={false}>
        <label className={styles.promptLabel} htmlFor={`ai-prompt-${blockId}`}>
          {knowledgeT('taskInstructions')}
        </label>
        <textarea
          id={`ai-prompt-${blockId}`}
          aria-label={knowledgeT('aiTaskInstructions')}
          placeholder={knowledgeT('describeWhatYouWantAiToDo')}
          rows={2}
          value={prompt}
          disabled={!editor.isEditable}
          onChange={(event) => updateAttributes({ prompt: event.target.value })}
        />
        <div className={styles.options}>
          <label>
            {knowledgeT('modelTier')}
            <select
              aria-label={knowledgeT('aiModelTier')}
              value={node.attrs.tier}
              disabled={!editor.isEditable}
              onChange={(event) => updateAttributes({ tier: event.target.value })}
            >
              <option value="fast">{knowledgeT('fast')}</option>
              <option value="smart">{knowledgeT('deep')}</option>
            </select>
          </label>
          {scope && editor.isEditable ? (
            <AiTaskActions
              scope={scope}
              taskId={taskId}
              blockId={blockId}
              prompt={prompt}
              tier={node.attrs.tier}
              onTaskId={(id) => updateAttributes({ taskId: id })}
              onError={setError}
            />
          ) : (
            <span className={styles.localNotice}>
              {knowledgeT('aiTasksRequireAConnectedTeamKnowledgeBase')}
            </span>
          )}
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className={styles.output}>
        <span className={styles.outputLabel} contentEditable={false}>
          {knowledgeT('resultEditable')}
        </span>
        <NodeViewContent className={styles.content} />
      </div>
    </NodeViewWrapper>
  );
}

function AiTaskActions({
  scope,
  taskId,
  blockId,
  prompt,
  tier,
  onTaskId,
  onError,
}: {
  scope: PageScope;
  taskId: string | null;
  blockId: string;
  prompt: string;
  tier: 'fast' | 'smart';
  onTaskId: (taskId: string | null) => void;
  onError: (message: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const task = useAiStreamingTask(scope.knowledgeBaseId, taskId);
  const [busy, setBusy] = useState(false);
  const status = task.snapshot?.status;
  const run = async () => {
    if (!prompt.trim() || !blockId) return;
    setBusy(true);
    onError('');
    try {
      const snapshot = await task.start({
        pageId: scope.pageId,
        insideBlockId: blockId,
        afterBlockId: null,
        prompt: prompt.trim(),
        tier,
      });
      onTaskId(snapshot.taskId);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : knowledgeT('unableToStartAiTask'));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    onError('');
    try {
      await task.cancel();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : knowledgeT('unableToCancel'));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setBusy(true);
    onError('');
    try {
      await task.revoke();
      onTaskId(null);
      task.reset();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : knowledgeT('unableToUndo'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.taskActions}>
      {status === 'running' ? (
        <>
          <span className={styles.status}>
            <CircleNotch aria-hidden className={styles.spin} size={14} />
            {knowledgeT('generating')}
            {task.snapshot?.blocksWritten ?? 0} {knowledgeT('block')}
          </span>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => void cancel()}
          >
            <Pause aria-hidden size={14} />
            {knowledgeT('stop')}
          </button>
        </>
      ) : (
        <>
          {status === 'done' ? (
            <span className={styles.status}>
              <CheckCircle aria-hidden size={14} />
              {knowledgeT('generated')}
              {task.snapshot?.blocksWritten ?? 0} {knowledgeT('block')}
            </span>
          ) : status === 'failed' ? (
            <span className={styles.failed}>{knowledgeT('generationFailedRetryIsAvailable')}</span>
          ) : status === 'cancelled' ? (
            <span className={styles.status}>{knowledgeT('stopped')}</span>
          ) : null}
          <button
            type="button"
            className={styles.primary}
            disabled={busy || !prompt.trim() || !blockId}
            onClick={() => void run()}
          >
            <Play aria-hidden size={14} />
            {status ? knowledgeT('regenerate') : knowledgeT('generate')}
          </button>
          {status ? (
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              title={knowledgeT('undoSuggestionBlocksFromThisTask')}
              onClick={() => void revoke()}
            >
              <Trash aria-hidden size={14} />
              {knowledgeT('undoGeneration')}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
