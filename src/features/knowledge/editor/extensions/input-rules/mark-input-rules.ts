/**
 * Inline mark shortcuts while typing — `**bold**`, `__bold__`, `*italic*`,
 * `_italic_` and `` `code` `` — the classic TipTap mark input rule patterns.
 * The engine itself refuses to run inside code blocks or while an IME
 * composition is open, and the marker characters are consumed while the
 * captured text gains the mark.
 */

import { Extension, markInputRule } from '@tiptap/core';

export const MarkInputRules = Extension.create({
  name: 'fobMarkInputRules',
  addInputRules() {
    const { bold, italic, code } = this.editor.schema.marks;
    const rules = [];
    if (bold) {
      rules.push(
        markInputRule({ find: /\*\*([^*]+)\*\*$/, type: bold }),
        markInputRule({ find: /__([^_]+)__$/, type: bold }),
      );
    }
    if (italic) {
      rules.push(
        markInputRule({ find: /(?:^|[^*])\*([^*]+)\*$/, type: italic }),
        markInputRule({ find: /(?:^|[^_])_([^_]+)_$/, type: italic }),
      );
    }
    if (code) {
      rules.push(markInputRule({ find: /`([^`]+)`$/, type: code }));
    }
    return rules;
  },
});
