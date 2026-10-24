/**
 * Instance-level tests of the awareness editor layer (B07) under happy-dom.
 *
 * Two real Tiptap Editors run the exact assembly the page surface mounts —
 * shared registry extensions, the E02 blockId extension, the E03
 * collaboration extension (both bound to the SAME Y.Doc page fragment, which
 * works in-process) — and each carries a `fobAwareness` extension over its
 * own y-protocols Awareness. The three awareness instances (A, B and a
 * backend-style agent) exchange updates the way the providers do. What is
 * proven end to end: a selection change on one side surfaces as the peer's
 * remote caret and selection highlight, the agent's plain-blockId cursor
 * renders with the agent flag and the editing pulse state, removing a peer's
 * state drops its decorations, and destroying an editor clears its published
 * presence.
 */

import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { beforeAll, describe, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { ySyncPluginKey } from 'y-prosemirror';
import { TextSelection } from '@tiptap/pm/state';
import { createBlockIdExtension, createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import type { AwarenessState } from '@fob/shared/knowledge/contracts';
import { awarenessColorFor, readAwarenessMembers } from '../../collaboration/awareness';
import type { AwarenessIdentity } from '../../collaboration/awareness';
import { createPageUndo } from '../../collaboration/page-undo';
import { pageCollaborationExtension } from '../page-collaboration';
import { createAwarenessExtension } from './awareness-extension';

const scope = { knowledgeBaseId: '00000000-0000-4000-8000-000000000001', pageId: '00000000-0000-4000-8000-000000000002' };

let window: Window;

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  for (const deadline = Date.now() + timeoutMs; !predicate(); ) {
    if (Date.now() > deadline) throw new Error('Test condition was not met in time.');
    await settle();
  }
}

/** The provider-style awareness exchange every member of the page joins. */
function connectAwarenessExchange(count: number): Awareness[] {
  const group: Awareness[] = [];
  for (let index = 0; index < count; index += 1) {
    const awareness = new Awareness(new Y.Doc());
    group.push(awareness);
    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const update = encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]);
      for (const other of group) {
        if (other !== awareness) applyAwarenessUpdate(other, update, 'test');
      }
    });
  }
  return group;
}

/**
 * Mounts an editor the way the surface does: the awareness arrives lazily
 * (null until the session announces it), mirroring the B04 provider timing.
 */
function mountEditor(document: Y.Doc, awareness: Awareness | (() => Awareness | null), identity: AwarenessIdentity): Editor {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const listeners = new Set<() => void>();
  const getAwareness = typeof awareness === 'function' ? awareness : () => awareness;
  return new Editor({
    element: host as unknown as HTMLElement,
    editable: true,
    extensions: [
      ...createKnowledgeExtensions(),
      createBlockIdExtension({ pageId: scope.pageId }),
      pageCollaborationExtension(document, createPageUndo({ document, bindingOrigins: [ySyncPluginKey] })),
      createAwarenessExtension({ getAwareness, subscribeAwareness: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }, identity }),
    ],
    onCreate() {
      // The session announces the provider (and its awareness) after mount.
      for (const listener of listeners) listener();
    },
  });
}

function caretsOf(editor: Editor, selector: string): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>(`.fob-awareness-caret${selector}`)];
}

describe('awareness cursors across two real editors', () => {
  test('two editors for the same account sync content without duplicate presence or own remote cursors', async () => {
    const shared = new Y.Doc();
    const [awarenessA, awarenessB] = connectAwarenessExchange(2);
    const identity = { userId: crypto.randomUUID(), name: 'Admin' };
    const a = mountEditor(shared, awarenessA, identity);
    const b = mountEditor(shared, awarenessB, identity);
    try {
      a.commands.setContent('<p>same account, two windows</p>');
      a.view.dispatch(a.state.tr.setSelection(TextSelection.create(a.state.doc, 2, 7)).setMeta('addToHistory', false));
      await until(() => Boolean(awarenessB.getStates().get(awarenessA.clientID)?.cursor));
      expect(b.state.doc.textContent).toBe('same account, two windows');
      expect(readAwarenessMembers(awarenessA, awarenessA.clientID)).toEqual([]);
      expect(readAwarenessMembers(awarenessB, awarenessB.clientID)).toEqual([]);
      expect(caretsOf(a, '[data-awareness-kind="human"]')).toHaveLength(0);
      expect(caretsOf(b, '[data-awareness-kind="human"]')).toHaveLength(0);
      expect(b.view.dom.querySelector('.fob-awareness-selection')).toBe(null);
    } finally {
      a.destroy();
      b.destroy();
      awarenessA.destroy();
      awarenessB.destroy();
      shared.destroy();
    }
  });

  test('a selection change on A renders A\'s caret flag and selection on B', async () => {
    const shared = new Y.Doc();
    const [awarenessA, awarenessB] = connectAwarenessExchange(2);
    const identityA: AwarenessIdentity = { userId: crypto.randomUUID(), name: '陈晓宇' };
    const identityB: AwarenessIdentity = { userId: crypto.randomUUID(), name: 'Bob' };
    const a = mountEditor(shared, awarenessA, identityA);
    const b = mountEditor(shared, awarenessB, identityB);

    a.commands.setContent('<p>hello collaborative world</p>');
    expect(b.state.doc.textContent).toBe('hello collaborative world');
    a.view.dispatch(a.state.tr
      .setSelection(TextSelection.create(a.state.doc, 4, 16))
      .setMeta('addToHistory', false));

    // Publishing is coalesced into a microtask; poll for the peer's widget.
    await until(() => caretsOf(b, '[data-awareness-kind="human"]').length > 0);
    const caret = caretsOf(b, `[data-awareness-client="${awarenessA.clientID}"]`)[0]!;
    expect(caretsOf(b, '[data-awareness-kind="human"]')).toHaveLength(1);
    expect(caret.dataset.awarenessClient).toBe(String(awarenessA.clientID));
    expect(caret.style.getPropertyValue('--fob-awareness-color')).toBe(awarenessColorFor(identityA.userId));
    const flag = caret.querySelector<HTMLElement>('.fob-awareness-flag');
    expect(flag?.textContent).toBe('陈晓宇');
    const selection = b.view.dom.querySelector<HTMLElement>('.fob-awareness-selection');
    expect(selection).not.toBe(null);
    expect(selection?.style.getPropertyValue('--fob-awareness-color')).toBe(awarenessColorFor(identityA.userId));

    a.destroy();
    b.destroy();
    for (const awareness of [awarenessA, awarenessB]) awareness.destroy();
    shared.destroy();
  });

  test('a backend agent state with a plain blockId cursor renders the agent flag and editing pulse', async () => {
    const shared = new Y.Doc();
    const [awarenessA, awarenessB, awarenessAgent] = connectAwarenessExchange(3);
    const a = mountEditor(shared, awarenessA, { userId: crypto.randomUUID(), name: '陈晓宇' });
    const b = mountEditor(shared, awarenessB, { userId: crypto.randomUUID(), name: 'Bob' });
    a.commands.setContent('<p>hello collaborative world</p><p>agent lands here</p>');

    // The backend streaming writer publishes exactly this shape (B09).
    const blockId = b.state.doc.child(1).attrs.blockId as string;
    expect(typeof blockId).toBe('string');
    awarenessAgent.setLocalState({
      user: { id: crypto.randomUUID(), name: '研究智能体' },
      color: '#0f766e',
      kind: 'agent',
      cursor: { anchor: blockId, head: blockId },
      selection: null,
      isEditing: true,
      taskId: crypto.randomUUID(),
    } satisfies AwarenessState);

    await until(() => caretsOf(b, '[data-awareness-kind="agent"]').length > 0);
    const caret = caretsOf(b, `[data-awareness-client="${awarenessAgent.clientID}"]`)[0]!;
    expect(caret.dataset.awarenessEditing).toBe('true');
    expect(caret.querySelector('svg.fob-awareness-agent-icon')).not.toBe(null);
    const flag = caret.querySelector<HTMLElement>('.fob-awareness-flag');
    expect(flag?.textContent).toBe('正在编辑');
    expect(flag?.title).toBe('研究智能体 · 正在编辑');
    // An empty agent range paints no selection highlight.
    expect(b.view.dom.querySelector('.fob-awareness-selection')).toBe(null);

    a.destroy();
    b.destroy();
    for (const awareness of [awarenessA, awarenessB, awarenessAgent]) awareness.destroy();
    shared.destroy();
  });

  test('removing a peer\'s state drops its decorations; editor destroy clears its presence', async () => {
    const shared = new Y.Doc();
    const [awarenessA, awarenessB] = connectAwarenessExchange(2);
    const a = mountEditor(shared, awarenessA, { userId: crypto.randomUUID(), name: 'Alice' });
    const b = mountEditor(shared, awarenessB, { userId: crypto.randomUUID(), name: 'Bob' });
    a.commands.setContent('<p>shared body</p>');
    a.view.dispatch(a.state.tr
      .setSelection(TextSelection.create(a.state.doc, 2, 7))
      .setMeta('addToHistory', false));
    await until(() => caretsOf(b, `[data-awareness-client="${awarenessA.clientID}"]`).length > 0);
    expect(awarenessA.getLocalState()).not.toBe(null);

    // Leaving (peer disconnect): the state is removed and the editor torn down
    // synchronously, so its publisher can never re-announce it afterwards.
    removeAwarenessStates(awarenessA, [awarenessA.clientID], 'test');
    a.destroy();
    await until(() => caretsOf(b, `[data-awareness-client="${awarenessA.clientID}"]`).length === 0);
    expect(b.view.dom.querySelector('.fob-awareness-selection')).toBe(null);

    // Destroying the editor detaches the publisher: the published state is gone.
    expect(awarenessA.getLocalState()).toBe(null);

    b.destroy();
    for (const awareness of [awarenessA, awarenessB]) awareness.destroy();
    shared.destroy();
  });

  test('the awareness attaches lazily once the session announces the provider', async () => {
    const shared = new Y.Doc();
    const [awarenessA, awarenessB] = connectAwarenessExchange(2);
    // B04 timing: the provider (and its awareness) only exists after the
    // local copy loads — B's editor mounts first against null.
    let sessionAwareness: Awareness | null = null;
    const host = window.document.createElement('div');
    window.document.body.appendChild(host);
    const listeners = new Set<() => void>();
    const b = new Editor({
      element: host as unknown as HTMLElement,
      editable: true,
      extensions: [
        ...createKnowledgeExtensions(),
        createBlockIdExtension({ pageId: scope.pageId }),
        pageCollaborationExtension(shared, createPageUndo({ document: shared, bindingOrigins: [ySyncPluginKey] })),
        createAwarenessExtension({
          getAwareness: () => sessionAwareness,
          subscribeAwareness: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          identity: { userId: crypto.randomUUID(), name: 'Bob' },
        }),
      ],
    });
    const a = mountEditor(shared, awarenessA, { userId: crypto.randomUUID(), name: 'Alice' });
    a.commands.setContent('<p>lazy provider body</p>');
    a.view.dispatch(a.state.tr
      .setSelection(TextSelection.create(a.state.doc, 1, 5))
      .setMeta('addToHistory', false));
    await until(() => awarenessB.getStates().size > 0);
    // No awareness yet: nothing renders and nothing throws.
    expect(caretsOf(b, '[data-awareness-kind="human"]')).toHaveLength(0);

    sessionAwareness = awarenessB;
    for (const listener of listeners) listener();
    await until(() => caretsOf(b, `[data-awareness-client="${awarenessA.clientID}"]`).length > 0);

    a.destroy();
    b.destroy();
    for (const awareness of [awarenessA, awarenessB]) awareness.destroy();
    shared.destroy();
  });
});
