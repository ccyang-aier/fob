'use client';

import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import type { Locale } from '@/lib/i18n';

export const editorLocaleMeta = 'fob-editor-locale';

/** Refresh presentation plugins without changing the document, selection or undo history. */
export function useEditorLocale(
  editor: Editor | null,
  locale: Locale,
  accessibleName?: string,
  placeholder?: string,
) {
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (accessibleName !== undefined || placeholder !== undefined) {
      const previous = editor.options.editorProps.attributes;
      const translated = {
        ...(accessibleName === undefined ? {} : { 'aria-label': accessibleName }),
        ...(placeholder === undefined ? {} : { 'data-placeholder': placeholder }),
      };
      editor.setOptions({
        editorProps: {
          ...editor.options.editorProps,
          attributes:
            typeof previous === 'function'
              ? (state) => ({ ...previous(state), ...translated })
              : { ...previous, ...translated },
        },
      });
    }
    editor.view.dispatch(
      editor.state.tr.setMeta(editorLocaleMeta, locale).setMeta('addToHistory', false),
    );
  }, [editor, locale, accessibleName, placeholder]);
}
