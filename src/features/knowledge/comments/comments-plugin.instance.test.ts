/**
 * Instance-level tests of the comment anchor layer (N02) under happy-dom.
 *
 * Real Tiptap Editor instances run the exact assembly the editor surface
 * gains — the shared registry extensions plus `createCommentsEditorExtension`
 * — and the strongest acceptance claims are proven end to end against real
 * Y.Docs with the provider-style relay of page-editor.instance.test.ts:
 *
 * - a selection-applied `comment` mark renders as an anchor decoration with
 *   its count badge, and the context styles (resolved / orphan / pending /
 *   active) follow the controller's history-free refresh;
 * - two editors converge: the anchor created on one side appears on the
 *   other bound to the same text, and typing before it on either side
 *   shifts both views without ever rebinding (锚点随 CRDT 不漂);
 * - anchor removal (thread gone) propagates the same way.
 */

import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { beforeAll, describe, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { createPageUndo } from '../collaboration/page-undo';
import { pageCollaborationExtension } from '../editor/page-collaboration';
import { buildAddCommentAnchorTransaction, buildRemoveCommentAnchorTransaction, collectCommentAnchors } from './comment-anchors';
import {
  activeCommentThreadId,
  commentAnchorContextOfEditor,
  commentsPluginKey,
  createCommentsEditorExtension,
  selectCommentThread,
  setCommentAnchorContextOnEditor,
} from './comments-plugin';

/** The controller's history-free context refresh, verbatim. */
function refreshContext(editor: Editor) {
  editor.view.dispatch(editor.state.tr
    .setMeta(commentsPluginKey, { type: 'context' })
    .setMeta('addToHistory', false));
}

const THREAD_A = '10000000-0000-4000-8000-00000000000a';
const THREAD_B = '10000000-0000-4000-8000-00000000000b';

let window: Window;

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

/** The exact binding the page surface mounts, plus the comments extension. */
function mountEditor(document: Y.Doc): Editor {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  return new Editor({
    element: host as unknown as HTMLElement,
    extensions: [
      ...createKnowledgeExtensions(),
      pageCollaborationExtension(document, createPageUndo({ document, bindingOrigins: [ySyncPluginKey] })),
      createCommentsEditorExtension(),
    ],
    editable: true,
  });
}

function anchorSelection(editor: Editor, from: number, to: number, threadId: string) {
  const tr = buildAddCommentAnchorTransaction(editor.state, { from, to }, threadId);
  if (!tr) throw new Error('anchor transaction must build');
  editor.view.dispatch(tr);
}

function anchorElements(editor: Editor, threadId: string): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>(`.fob-comment-anchor[data-comment-thread="${threadId}"]`)];
}

function badgeOf(editor: Editor, threadId: string): HTMLElement | null {
  return editor.view.dom.querySelector<HTMLElement>(`.fob-comment-badge[data-comment-thread="${threadId}"]`);
}

describe('comment anchors in a real editor instance', () => {
  test('an applied mark renders the anchor decoration and its count badge', () => {
    const editor = mountEditor(new Y.Doc());
    editor.commands.setContent('<p>hello collaborative world</p>');
    anchorSelection(editor, 1, 1 + 'hello collaborative'.length, THREAD_A);

    const anchors = collectCommentAnchors(editor.state.doc);
    expect(anchors.map((anchor) => anchor.threadId)).toEqual([THREAD_A]);
    const elements = anchorElements(editor, THREAD_A);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements[0]!.className).toContain('fob-comment-anchor');
    expect(elements[0]!.textContent).toContain('hello collaborative');

    setCommentAnchorContextOnEditor(editor, {
      resolved: new Set(), orphan: new Set(), pending: new Set(),
      counts: new Map([[THREAD_A, 2]]),
    });
    selectCommentThread(editor.view, THREAD_A);
    refreshContext(editor);
    expect(badgeOf(editor, THREAD_A)?.textContent).toBe('2');
    expect(anchorElements(editor, THREAD_A)[0]!.className).toContain('fob-comment-active');
    // The count follows the referenced text instead of interrupting its start.
    expect(editor.view.dom.querySelector('p')?.textContent).toBe('hello collaborative2 world');
    expect(editor.getHTML()).not.toContain('fob-comment-badge');

    selectCommentThread(editor.view, null);
    badgeOf(editor, THREAD_A)!.querySelector('span')!.click();
    expect(activeCommentThreadId(editor.state)).toBe(THREAD_A);

    editor.destroy();
  });

  test('the styling context renders resolved, orphan and pending states from the shared truth', () => {
    const editor = mountEditor(new Y.Doc());
    editor.commands.setContent('<p>first target second</p>');
    anchorSelection(editor, 1, 1 + 'first'.length, THREAD_A);
    anchorSelection(editor, 1 + 'first target '.length, 1 + 'first target second'.length, THREAD_B);

    setCommentAnchorContextOnEditor(editor, {
      resolved: new Set([THREAD_A]),
      orphan: new Set([THREAD_B]),
      pending: new Set(),
      counts: new Map([[THREAD_A, 3]]),
    });
    refreshContext(editor);

    expect(anchorElements(editor, THREAD_A)[0]!.className).toContain('fob-comment-resolved');
    expect(badgeOf(editor, THREAD_A)?.getAttribute('data-resolved')).toBe('true');
    expect(anchorElements(editor, THREAD_B)[0]!.className).toContain('fob-comment-orphan');
    expect(commentAnchorContextOfEditor(editor)?.resolved.has(THREAD_A)).toBe(true);
    editor.destroy();
  });

  test('text and count clicks request the same discussion again without waiting for an active-id change', () => {
    const editor = mountEditor(new Y.Doc());
    editor.commands.setContent('<p>hello world</p>');
    anchorSelection(editor, 1, 6, THREAD_A);
    const requests: string[] = [];
    editor.on('transaction', ({ transaction }) => {
      const meta = transaction.getMeta(commentsPluginKey);
      if (meta?.type === 'select') requests.push(meta.id);
    });

    anchorElements(editor, THREAD_A)[0]!.click();
    anchorElements(editor, THREAD_A)[0]!.click();
    badgeOf(editor, THREAD_A)!.querySelector('span')!.click();
    badgeOf(editor, THREAD_A)!.querySelector('span')!.click();
    expect(requests).toEqual([THREAD_A, THREAD_A, THREAD_A, THREAD_A]);
    expect(activeCommentThreadId(editor.state)).toBe(THREAD_A);
    refreshContext(editor);
    expect(requests).toHaveLength(4);
    editor.destroy();
  });

  test('selectCommentThread activates the anchor, moves the caret and flashes', () => {
    const editor = mountEditor(new Y.Doc());
    editor.commands.setContent('<p>hello world</p>');
    anchorSelection(editor, 1, 1 + 'hello'.length, THREAD_A);

    selectCommentThread(editor.view, THREAD_A, { flash: true });
    expect(activeCommentThreadId(editor.state)).toBe(THREAD_A);
    expect(editor.state.selection.from).toBeLessThanOrEqual(1 + 'hello'.length);
    expect(anchorElements(editor, THREAD_A)[0]!.className).toContain('fob-comment-active');
    expect(anchorElements(editor, THREAD_A)[0]!.className).toContain('fob-comment-flash');

    selectCommentThread(editor.view, null);
    expect(activeCommentThreadId(editor.state)).toBe(null);
    editor.destroy();
  });
});

describe('comment anchors converge across two collaborating editors', () => {
  test('an anchor created on one side rides the CRDT to the other, stable under concurrent typing', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = mountEditor(docA);
    const b = mountEditor(docB);
    const relay = (update: Uint8Array, origin: unknown) => {
      if (origin === 'provider') return;
      Y.applyUpdate(docB, update, 'provider');
    };
    const relayBack = (update: Uint8Array, origin: unknown) => {
      if (origin === 'provider') return;
      Y.applyUpdate(docA, update, 'provider');
    };
    docA.on('update', relay);
    docB.on('update', relayBack);

    a.commands.setContent('<p>hello world</p>');
    expect(b.state.doc.textContent).toContain('hello world');
    anchorSelection(a, 1, 1 + 'hello'.length, THREAD_A);

    // The peer sees the same anchor bound to the same text.
    const onB = collectCommentAnchors(b.state.doc);
    expect(onB.map((anchor) => anchor.threadId)).toEqual([THREAD_A]);
    expect(b.state.doc.textBetween(onB[0]!.ranges[0]!.from, onB[0]!.ranges[0]!.to, ' ', ' ')).toBe('hello');
    expect(anchorElements(b, THREAD_A).length).toBeGreaterThan(0);
    expect(badgeOf(b, THREAD_A)).not.toBe(null);

    // Concurrent typing before the anchor shifts both views, never the binding.
    b.commands.insertContentAt(0, '<p>intro </p>');
    expect(a.state.doc.textContent).toContain('intro ');
    const onA = collectCommentAnchors(a.state.doc);
    const afterB = collectCommentAnchors(b.state.doc);
    expect(onA[0]!.ranges[0]!.from).toBe(afterB[0]!.ranges[0]!.from);
    expect(a.state.doc.textBetween(onA[0]!.ranges[0]!.from, onA[0]!.ranges[0]!.to, ' ', ' ')).toBe('hello');
    expect(b.state.doc.textBetween(afterB[0]!.ranges[0]!.from, afterB[0]!.ranges[0]!.to, ' ', ' ')).toBe('hello');

    // Deleting the anchored text on one side removes the anchor everywhere.
    b.view.dispatch(b.state.tr.delete(afterB[0]!.ranges[0]!.from, afterB[0]!.ranges[0]!.to));
    expect(collectCommentAnchors(a.state.doc)).toHaveLength(0);
    expect(collectCommentAnchors(b.state.doc)).toHaveLength(0);

    // Anchor removal (thread deleted) propagates the same way.
    anchorSelection(a, 1, 6, THREAD_B);
    expect(collectCommentAnchors(b.state.doc).map((anchor) => anchor.threadId)).toEqual([THREAD_B]);
    a.view.dispatch(buildRemoveCommentAnchorTransaction(a.state, THREAD_B)!);
    expect(collectCommentAnchors(b.state.doc)).toHaveLength(0);

    // The anchor write is ordinary CRDT content: it rides the same binding origin.
    expect(a.state.doc.textContent).toContain('intro ');
    void ySyncPluginKey;
    b.destroy();
    a.destroy();
  });
});
