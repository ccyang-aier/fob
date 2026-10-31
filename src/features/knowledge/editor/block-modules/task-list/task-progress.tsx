'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './task-progress.messages';
import { useCallback, useSyncExternalStore } from 'react';
import type { Editor, EditorEvents } from '@tiptap/core';
import { CheckCircle } from '@/components/icons';
import { countCheckedTasks } from './progress-state';

/** Metadata counts derive from the live editor document, including collaborative updates. */
export function TaskProgress({ editor }: { editor: Editor | null }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!editor) return () => {};
      const update = ({ transaction }: EditorEvents['transaction']) => { if (transaction.docChanged) notify(); };
      editor.on('transaction', update);
      return () => {
        editor.off('transaction', update);
      };
    },
    [editor],
  );
  const snapshot = useCallback(() => {
    if (!editor || editor.isDestroyed) return 0;
    return countCheckedTasks(editor.state.doc);
  }, [editor]);
  const checked = useSyncExternalStore(subscribe, snapshot, () => 0);
  return (
    <span className="inline-flex items-center gap-1">
      <CheckCircle size={14} className="text-[#0869cf]" aria-hidden />
      {knowledgeT('completed')}
      {checked} {knowledgeT('tasks')}
    </span>
  );
}
