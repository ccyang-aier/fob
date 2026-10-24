'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './task-progress.messages';
import { useCallback, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { CheckCircle } from '@phosphor-icons/react';

/** Metadata counts derive from the live editor document, including collaborative updates. */
export function TaskProgress({ editor }: { editor: Editor | null }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!editor) return () => {};
      editor.on('transaction', notify);
      return () => {
        editor.off('transaction', notify);
      };
    },
    [editor],
  );
  const snapshot = useCallback(() => {
    if (!editor || editor.isDestroyed) return 0;
    let checked = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'taskItem' && node.attrs.checked) checked += 1;
    });
    return checked;
  }, [editor]);
  const checked = useSyncExternalStore(subscribe, snapshot, () => 0);
  return (
    <span className="inline-flex items-center gap-1">
      <CheckCircle size={14} weight="fill" className="text-[#0869cf]" aria-hidden />
      {knowledgeT('completed')}
      {checked} {knowledgeT('tasks')}
    </span>
  );
}
