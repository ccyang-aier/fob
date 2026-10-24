'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './history-panel.messages';
/**
 * History panel (V03 §5.3): version list with authors and labels, a read-only
 * preview per checkpoint, one-click "name this version", and restore. Restore
 * replaces the live body in a single editor transaction — undoable for the
 * restoring user, an ordinary update for everyone else.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClockCounterClockwise, FloppyDisk, Spinner } from '@phosphor-icons/react';
import type { Editor } from '@tiptap/react';
import { useAppAlert } from '@/components/app-alert-provider';
import { createHistoryApi } from './history-api';
import type { HistoryApi, PageCheckpointEntry, PageCheckpointPreview } from './history-api';
import { buildRestoreTransaction, renderCheckpointHtml } from './restore';

type Phase = 'loading' | 'ready' | 'error';

const shortAuthor = (userId: string) => userId.slice(0, 8);

export interface HistoryPanelProps {
  knowledgeBaseId: string;
  pageId: string;
  /** The live editor; null while the surface is read-only or still mounting. */
  editor: Editor | null;
  /** Edit permission gates naming and restoring. */
  canEdit: boolean;
  onClose: () => void;
  api?: HistoryApi;
}

export function HistoryPanel({
  knowledgeBaseId,
  pageId,
  editor,
  canEdit,
  onClose,
  api = createHistoryApi(),
}: HistoryPanelProps) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);
  const formatter = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const [phase, setPhase] = useState<Phase>('loading');
  const [entries, setEntries] = useState<PageCheckpointEntry[]>([]);
  const [selected, setSelected] = useState<{
    preview: PageCheckpointPreview;
    html: string | null;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useAppAlert();
  const listRef = useRef(api.list);

  const reload = useCallback(async () => {
    try {
      const { checkpoints } = await listRef.current(knowledgeBaseId, pageId);
      setEntries(checkpoints);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [knowledgeBaseId, pageId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openPreview = useCallback(
    async (checkpointId: string) => {
      setPreviewBusy(true);
      try {
        const preview = await api.preview(knowledgeBaseId, pageId, checkpointId);
        setSelected({
          preview,
          html: editor ? renderCheckpointHtml(preview.body, editor.schema) : null,
        });
      } catch {
        notify('error', knowledgeT('unableToLoadVersionPreviewPleaseRetry'));
      } finally {
        setPreviewBusy(false);
      }
    },
    [api, editor, knowledgeBaseId, pageId, notify, knowledgeT],
  );

  const nameVersion = useCallback(async () => {
    const trimmed = label.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const result = await api.name(knowledgeBaseId, pageId, trimmed);
      setNaming(false);
      setLabel('');
      notify(
        'success',
        result.outcome === 'created'
          ? knowledgeT('namedVersionSaved')
          : knowledgeT('contentMatchesTheLatestVersionThatVersionHas'),
      );
      await reload();
    } catch {
      notify('error', knowledgeT('nameMustContain1200Characters'));
    } finally {
      setBusy(false);
    }
  }, [api, busy, label, pageId, reload, knowledgeBaseId, notify, knowledgeT]);

  const restore = useCallback(() => {
    if (!selected || !editor || busy) return;
    const transaction = buildRestoreTransaction(editor.state, selected.preview.body);
    if (!transaction) {
      notify('error', knowledgeT('thisVersionCouldNotBeParsedOrRestored'));
      return;
    }
    editor.view.dispatch(transaction);
    notify('success', knowledgeT('versionRestoredUndoCtrlZToReturnTo'));
    onClose();
  }, [busy, editor, onClose, selected, notify, knowledgeT]);

  const sortedAuthors = useMemo(
    () => (selected?.preview.authors ?? []).map(shortAuthor).join(locale === 'zh-CN' ? '、' : ', '),
    [selected, locale],
  );

  return (
    <section
      aria-label={knowledgeT('pageVersionHistory')}
      className="flex h-full flex-col gap-4 p-4"
    >
      <header className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <ClockCounterClockwise aria-hidden className="size-4" />
          {knowledgeT('versionHistory')}
        </h3>
        {canEdit && !naming && (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-overlay hover:text-ink"
          >
            <FloppyDisk aria-hidden className="size-3.5" />
            {knowledgeT('nameCurrentVersion')}
          </button>
        )}
      </header>

      {naming && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void nameVersion();
          }}
        >
          <input
            autoFocus
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={200}
            placeholder={knowledgeT('versionNameEGReviewBaseline')}
            aria-label={knowledgeT('versionName')}
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1.5 text-xs text-ink outline-none focus-visible:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={busy || !label.trim()}
            className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-45"
          >
            {knowledgeT('save')}
          </button>
          <button
            type="button"
            onClick={() => setNaming(false)}
            className="rounded-md px-2 py-1.5 text-xs text-muted hover:text-ink"
          >
            {knowledgeT('cancel')}
          </button>
        </form>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {phase === 'loading' && (
          <p className="flex items-center gap-2 px-1 text-xs text-muted">
            <Spinner aria-hidden className="size-3.5 animate-spin" />
            {knowledgeT('loadingVersions')}
          </p>
        )}
        {phase === 'error' && (
          <div className="flex flex-col items-start gap-2 text-xs text-muted">
            <p>{knowledgeT('versionHistoryIsTemporarilyUnavailable')}</p>
            <button
              type="button"
              onClick={() => {
                setPhase('loading');
                void reload();
              }}
              className="rounded-md border border-line px-2 py-1 text-ink transition-colors hover:bg-overlay"
            >
              {knowledgeT('retry')}
            </button>
          </div>
        )}
        {phase === 'ready' && entries.length === 0 && (
          <p className="px-1 text-xs text-muted">
            {knowledgeT('noVersionsYetACheckpointIsSavedAfter')}
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => {
            const active = selected?.preview.checkpointId === entry.checkpointId;
            return (
              <li key={entry.checkpointId}>
                <button
                  type="button"
                  onClick={() => void openPreview(entry.checkpointId)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${active ? 'bg-overlay' : 'hover:bg-overlay/60'}`}
                >
                  <span className="block truncate text-xs text-ink">
                    {entry.label ?? formatter.format(new Date(entry.createdAt))}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {formatter.format(new Date(entry.createdAt))}
                    {entry.label ? '' : ''}
                    {entry.authors.length > 0 &&
                      ` · ${entry.authors.map(shortAuthor).join(locale === 'zh-CN' ? '、' : ', ')}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected && (
        <div className="flex min-h-0 flex-[1.4] flex-col gap-2 rounded-lg border border-line bg-panel p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-ink">
                {selected.preview.label ?? knowledgeT('unnamedVersion')}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-muted">
                {formatter.format(new Date(selected.preview.createdAt))}
                {sortedAuthors && ` · ${sortedAuthors}`}
              </p>
            </div>
            {previewBusy && <Spinner aria-hidden className="size-3.5 animate-spin text-muted" />}
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed text-ink knowledge-preview"
            // Checkpoint HTML is serialized from schema-validated ProseMirror nodes, not user strings.
            dangerouslySetInnerHTML={selected.html ? { __html: selected.html } : undefined}
          >
            {!selected.html && (
              <p className="text-xs text-muted">
                {knowledgeT('thisVersionIsEmptyOrCannotBePreviewed')}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">
              {knowledgeT('restoringReplacesTheCurrentContentWithASingle')}
            </p>
            <button
              type="button"
              onClick={restore}
              disabled={!canEdit || !editor || previewBusy}
              title={!canEdit ? knowledgeT('pageEditingPermissionRequired') : undefined}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-45"
            >
              {knowledgeT('restoreThisVersion')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
