/**
 * Component tests of the review panel (S02) under happy-dom: the real
 * ReviewPanel React component over a real Tiptap editor instance carrying the
 * review extension — the same assembly `PageReviewRail` mounts inside the
 * editor surface. Every interaction runs through real DOM events (act +
 * element.click), so what is proven is the closed loop the reviewer drives:
 * cards with author/time/excerpt, per-suggestion and batch accept/reject
 * against the live document, the readonly disabled matrix, locate selecting
 * the suggestion, and the open/close keyboard contract.
 */

import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { collectSuggestions, newSuggestion, suggestText } from '@fob/shared/knowledge/schema/suggestions';
import { createReviewMarksExtension, activeSuggestionId } from './review-marks';
import { ReviewPanel } from './review-panel';

let window: Window;
const roots: Root[] = [];
const editors: Editor[] = [];

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
  }
});

afterAll(() => {
  for (const editor of editors) editor.destroy();
});

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function mountEditor(editable = true): Editor {
  const element = window.document.createElement('div');
  window.document.body.appendChild(element);
  const editor = new Editor({
    element: element as unknown as HTMLElement,
    editable,
    extensions: [...createKnowledgeExtensions(), createReviewMarksExtension()],
  });
  editors.push(editor);
  editor.commands.setContent('<p>abcdef</p>');
  return editor;
}

function endOfFirstParagraph(editor: Editor): number {
  return editor.state.doc.resolve(1).after(1) - 1;
}

function propose(editor: Editor, options: { from: number; to: number; text: string; id: string; author?: string; minutesAgo?: number }) {
  editor.view.dispatch(
    suggestText(editor.state, {
      from: options.from,
      to: options.to,
      text: options.text,
      suggestion: newSuggestion(options.author ?? 'agent:task_1', {
        suggestionId: options.id,
        createdAt: minutesAgo(options.minutesAgo ?? 5),
      }),
    }),
  );
}

async function mountPanel(editor: Editor, editable = true): Promise<HTMLElement> {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  roots.push(root);
  await act(async () => {
    root.render(<ReviewPanel editor={editor} editable={editable} />);
    // Let Tiptap's asynchronous create/update events flush inside act.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host as unknown as HTMLElement;
}

function byText(scope: HTMLElement, text: string): HTMLButtonElement {
  const match = [...scope.querySelectorAll('button')].find((button) => button.textContent?.includes(text));
  if (!match) throw new Error(`button not found: ${text}`);
  return match;
}

async function click(button: HTMLElement) {
  await act(async () => {
    button.click();
  });
}

describe('ReviewPanel over a live editor', () => {
  test('renders one card per suggestion with author, time and excerpt, plus batch actions', async () => {
    const editor = mountEditor();
    const at = endOfFirstParagraph(editor);
    propose(editor, { from: at, to: at, text: '新增', id: 'ins-1', author: 'agent:task_1', minutesAgo: 5 });
    propose(editor, { from: 1, to: 3, text: '', id: 'del-1', author: 'mcp:Claude%20Desktop:call_9', minutesAgo: 65 });

    const panel = await mountPanel(editor);
    expect(panel.querySelector('aside[aria-label="建议审阅"]')).not.toBeNull();
    const cards = [...panel.querySelectorAll<HTMLElement>('[data-suggestion-id]')];
    // Document order: the deletion (positions 1..3) precedes the insertion.
    expect(cards.map((card) => card.dataset.suggestionId)).toEqual(['del-1', 'ins-1']);
    expect(cards[0].textContent).toContain('删除');
    expect(cards[0].textContent).toContain('Claude Desktop');
    expect(cards[0].textContent).toContain('1 小时前');
    expect(cards[1].textContent).toContain('插入');
    expect(cards[1].textContent).toContain('AI 助手');
    expect(cards[1].textContent).toContain('新增');
    expect(cards[1].textContent).toContain('5 分钟前');

    expect(panel.textContent).toContain('2 条建议 · 1 插入 · 1 删除 · 0 替换');
    expect(byText(panel, '全部接受')).toBeDefined();
    expect(byText(panel, '全部拒绝')).toBeDefined();
  });

  test('accepting one card applies it and the card leaves the list', async () => {
    const editor = mountEditor();
    const at = endOfFirstParagraph(editor);
    propose(editor, { from: at, to: at, text: '新增', id: 'ins-1' });
    propose(editor, { from: 1, to: 3, text: '', id: 'del-1' });

    const panel = await mountPanel(editor);
    await click(byText(panel.querySelector<HTMLElement>('[data-suggestion-id="ins-1"]')!, '接受'));

    expect(collectSuggestions(editor.state.doc).map((s) => s.suggestionId)).toEqual(['del-1']);
    expect(editor.state.doc.textContent).toContain('新增');
    expect(editor.state.doc.textContent).toContain('ab'); // the deletion is still only proposed
    const cards = [...panel.querySelectorAll<HTMLElement>('[data-suggestion-id]')];
    expect(cards.map((card) => card.dataset.suggestionId)).toEqual(['del-1']);
  });

  test('rejecting one card restores the original text', async () => {
    const editor = mountEditor();
    const at = endOfFirstParagraph(editor);
    propose(editor, { from: at, to: at, text: '新增', id: 'ins-1' });

    const panel = await mountPanel(editor);
    await click(byText(panel, '拒绝'));
    expect(collectSuggestions(editor.state.doc)).toHaveLength(0);
    expect(editor.state.doc.textContent).toBe('abcdef');
  });

  test('全部接受 resolves every suggestion in one batch and the rail retires itself', async () => {
    const editor = mountEditor();
    const at = endOfFirstParagraph(editor);
    propose(editor, { from: at, to: at, text: '新增', id: 'ins-1' });
    propose(editor, { from: 1, to: 3, text: '', id: 'del-1' });

    const panel = await mountPanel(editor);
    await click(byText(panel, '全部接受'));
    expect(collectSuggestions(editor.state.doc)).toHaveLength(0);
    expect(editor.state.doc.textContent).toBe('cdef新增');
    // No outstanding suggestions left: neither the panel nor the tab renders.
    expect(panel.querySelector('aside')).toBeNull();
    expect(panel.textContent).not.toContain('审阅');
  });

  test('readonly pages render everything but disable every decision with the reason', async () => {
    const editor = mountEditor(false);
    const at = endOfFirstParagraph(editor);
    propose(editor, { from: at, to: at, text: '新增', id: 'ins-1' });

    const panel = await mountPanel(editor, false);
    const card = panel.querySelector<HTMLElement>('[data-suggestion-id="ins-1"]')!;
    for (const label of ['接受', '拒绝', '全部接受', '全部拒绝']) {
      const button = byText(panel, label);
      expect(button.disabled).toBe(true);
      expect(button.title).toContain('只读');
    }
    void card;
    // The suggestion itself stays fully reviewable as text.
    expect(card.textContent).toContain('新增');
  });

  test('locating a card selects it in the document', async () => {
    const editor = mountEditor();
    const at = endOfFirstParagraph(editor);
    propose(editor, { from: at, to: at, text: '新增', id: 'ins-1' });

    const panel = await mountPanel(editor);
    const cardButton = [...panel.querySelectorAll('button')].find((button) => button.getAttribute('aria-label')?.startsWith('定位建议'))!;
    await click(cardButton);
    expect(activeSuggestionId(editor.state)).toBe('ins-1');
    const activeCard = panel.querySelector('[data-suggestion-id="ins-1"]');
    expect(activeCard).not.toBeNull();
  });

  test('Escape collapses to the count tab; the tab reopens the panel', async () => {
    const editor = mountEditor();
    const at = endOfFirstParagraph(editor);
    propose(editor, { from: at, to: at, text: '新增', id: 'ins-1' });

    const panel = await mountPanel(editor);
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(panel.querySelector('aside')).toBeNull();
    const tab = byText(panel, '审阅 1');
    expect(tab.getAttribute('aria-expanded')).toBe('false');

    await click(tab);
    expect(panel.querySelector('aside[aria-label="建议审阅"]')).not.toBeNull();
  });

  test('stats chips stay distinct for two AI tasks of the same label', async () => {
    const editor = mountEditor();
    const at = endOfFirstParagraph(editor);
    propose(editor, { from: at, to: at, text: '甲任务建议', id: 'a-1', author: 'agent:task_a' });
    propose(editor, { from: 1, to: 3, text: '', id: 'd-1', author: 'agent:task_b' });

    const panel = await mountPanel(editor);
    // Two agent tasks → two author entries sharing the 'AI 助手' label. They
    // must both render (distinct React keys include the task detail) and each
    // shows its pending count. Scoped outside the card list so the cards' own
    // author chips do not count.
    const chips = [...panel.querySelectorAll('span')]
      .filter((span) => !span.closest('ul') && span.textContent?.includes('AI 助手'));
    expect(chips).toHaveLength(2);
    expect(panel.textContent).toContain('2 条建议');
  });

  test('a suggestion arriving later opens the rail; a deliberate close survives new arrivals', async () => {
    const editor = mountEditor();
    const panel = await mountPanel(editor);
    expect(panel.querySelector('aside')).toBeNull();

    // An agent proposal streams in after mount: the rail opens on its own.
    const at = endOfFirstParagraph(editor);
    await act(async () => {
      propose(editor, { from: at, to: at, text: '新增', id: 'ins-1' });
    });
    expect(panel.querySelector('aside[aria-label="建议审阅"]')).not.toBeNull();

    // Once dismissed, later arrivals do not force it open again.
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
      propose(editor, { from: 1, to: 2, text: '', id: 'del-2' });
    });
    expect(panel.querySelector('aside')).toBeNull();
    expect(panel.textContent).toContain('审阅 2');
  });
});
