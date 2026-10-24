/**
 * Instance-level tests of the review marks extension (S02) under happy-dom:
 * a real Tiptap Editor with the shared registry extensions plus the review
 * extension — the same review assembly `PageEditorSurface` mounts. What is
 * proven against the live DOM: insert/delete decorations and author badges
 * render for every outstanding suggestion, selection drives the active
 * suggestion (with the locate flash), resolving a suggestion clears its
 * decorations and the active state, and readonly pages still render the
 * same review presentation.
 */

import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import { setLocale } from '@/lib/i18n';
import { editorLocaleMeta } from '../use-editor-locale';
import { TextSelection } from '@tiptap/pm/state';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import {
  newSuggestion,
  reviewSuggestions,
  suggestText,
} from '@fob/shared/knowledge/schema/suggestions';
import {
  activeSuggestionId,
  createReviewMarksExtension,
  selectReviewSuggestion,
} from './review-marks';

let window: Window;

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of [
    'document',
    'DOMParser',
    'MutationObserver',
    'Range',
    'getSelection',
    'HTMLElement',
    'Element',
    'Node',
    'Text',
    'Comment',
    'customElements',
    'requestAnimationFrame',
  ]) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

const createdAt = '2026-09-26T06:00:00.000Z';
const editors: Editor[] = [];

function mountEditor(editable = true): Editor {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const editor = new Editor({
    element: host as unknown as HTMLElement,
    editable,
    extensions: [...createKnowledgeExtensions(), createReviewMarksExtension()],
  });
  editors.push(editor);
  return editor;
}

/** End-of-text position of the (single) first paragraph. */
function endOfFirstParagraph(editor: Editor): number {
  return editor.state.doc.resolve(1).after(1) - 1;
}

function propose(
  editor: Editor,
  options: { from: number; to: number; text: string; id: string; author?: string },
) {
  editor.view.dispatch(
    suggestText(editor.state, {
      from: options.from,
      to: options.to,
      text: options.text,
      suggestion: newSuggestion(options.author ?? 'agent:task_1', {
        suggestionId: options.id,
        createdAt,
      }),
    }),
  );
}

afterAll(() => {
  for (const editor of editors) editor.destroy();
});

describe('review marks over a real editor instance', () => {
  test('language-only transactions refresh an existing author badge without changing suggestions', () => {
    const editor = mountEditor();
    editor.commands.setContent('<p>原始名称 Alpha</p>');
    const at = endOfFirstParagraph(editor);
    propose(editor, { from: at, to: at, text: '用户正文', id: 'localized-badge' });
    const doc = editor.state.doc;
    const dom = editor.view.dom as unknown as HTMLElement;
    expect(dom.querySelector('.fob-suggest-badge')?.getAttribute('title')).toContain('AI 助手');
    try {
      setLocale('en-US');
      editor.view.dispatch(
        editor.state.tr.setMeta(editorLocaleMeta, 'en-US').setMeta('addToHistory', false),
      );
      expect(dom.querySelector('.fob-suggest-badge')?.getAttribute('title')).toContain(
        'AI assistant',
      );
      expect(editor.state.doc).toBe(doc);
      expect(editor.state.doc.textContent).toContain('原始名称 Alpha');
    } finally {
      setLocale('zh-CN');
    }
  });
  test('insert and delete decorations and author badges render in the live DOM', async () => {
    const editor = mountEditor();
    editor.commands.setContent('<p>abcdef</p>');
    const insertAt = endOfFirstParagraph(editor);
    propose(editor, {
      from: insertAt,
      to: insertAt,
      text: '新增',
      id: 'ins-1',
      author: 'agent:task_1',
    });
    propose(editor, {
      from: 1,
      to: 3,
      text: '',
      id: 'del-1',
      author: 'mcp:Claude%20Desktop:call_9',
    });

    const dom = editor.view.dom as unknown as HTMLElement;
    const inserted = dom.querySelectorAll<HTMLElement>('.fob-suggest-insert');
    const deleted = dom.querySelectorAll<HTMLElement>('.fob-suggest-delete');
    expect(inserted.length).toBeGreaterThan(0);
    expect(deleted.length).toBeGreaterThan(0);
    expect(inserted[0].getAttribute('data-suggestion-id')).toBe('ins-1');
    expect(inserted[0].textContent).toContain('新增');
    expect(deleted[0].getAttribute('data-suggestion-id')).toBe('del-1');
    expect(deleted[0].textContent).toContain('ab');

    const badges = [...dom.querySelectorAll<HTMLElement>('.fob-suggest-badge')];
    expect(badges.map((badge) => badge.dataset.suggestionId).sort()).toEqual(['del-1', 'ins-1']);
    const agentBadge = badges.find((badge) => badge.dataset.suggestionId === 'ins-1');
    const mcpBadge = badges.find((badge) => badge.dataset.suggestionId === 'del-1');
    expect(agentBadge?.dataset.kind).toBe('agent');
    expect(agentBadge?.textContent).toBe('AI');
    expect(mcpBadge?.dataset.kind).toBe('mcp');
    expect(mcpBadge?.textContent).toBe('MCP');
    // The presentation stylesheet is injected once per document (Tiptap 3
    // emits `create` asynchronously, so it lands a tick after mounting).
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(window.document.getElementById('fob-review-marks-styles')).not.toBeNull();
  });

  test('manual selection drives the active decoration and the locate flash', () => {
    const editor = mountEditor();
    editor.commands.setContent('<p>abcdef</p>');
    propose(editor, {
      from: endOfFirstParagraph(editor),
      to: endOfFirstParagraph(editor),
      text: '新增',
      id: 'ins-2',
    });

    const dom = editor.view.dom as unknown as HTMLElement;
    selectReviewSuggestion(editor.view, 'ins-2', { flash: true });
    expect(activeSuggestionId(editor.state)).toBe('ins-2');
    // Selection moved onto the suggestion (the caret agrees with the pick).
    expect(editor.state.selection.from).toBeGreaterThan(0);
    const active = dom.querySelector('.fob-suggest-active');
    expect(active?.getAttribute('data-suggestion-id')).toBe('ins-2');
    expect(active?.classList.contains('fob-suggest-flash')).toBe(true);

    // A caret move onto no suggestion keeps a manual pick (it persists
    // honestly instead of flickering away on unrelated caret moves).
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, 1))
        .setMeta('addToHistory', false),
    );
    expect(activeSuggestionId(editor.state)).toBe('ins-2');
  });

  test('accept removes marks, badges and the active suggestion', () => {
    const editor = mountEditor();
    editor.commands.setContent('<p>abcdef</p>');
    propose(editor, {
      from: endOfFirstParagraph(editor),
      to: endOfFirstParagraph(editor),
      text: '新增',
      id: 'ins-3',
    });
    selectReviewSuggestion(editor.view, 'ins-3');
    expect(activeSuggestionId(editor.state)).toBe('ins-3');

    editor.view.dispatch(
      reviewSuggestions(editor.state, { decision: 'accept', suggestionIds: ['ins-3'] }),
    );
    const dom = editor.view.dom as unknown as HTMLElement;
    expect(dom.querySelector('.fob-suggest-insert')).toBeNull();
    expect(dom.querySelector('.fob-suggest-badge')).toBeNull();
    expect(activeSuggestionId(editor.state)).toBeNull();
    expect(editor.state.doc.textContent).toContain('新增');
  });

  test('a readonly editor renders the same review presentation', () => {
    const editor = mountEditor(false);
    editor.commands.setContent('<p>abcdef</p>');
    propose(editor, {
      from: endOfFirstParagraph(editor),
      to: endOfFirstParagraph(editor),
      text: '新增',
      id: 'ins-5',
    });
    const dom = editor.view.dom as unknown as HTMLElement;
    expect(dom.querySelector('.fob-suggest-insert')).not.toBeNull();
    expect(dom.querySelector('.fob-suggest-badge')).not.toBeNull();
    // Decisions still refuse: the S01 transaction is never dispatched.
    expect(editor.isEditable).toBe(false);
  });
});
