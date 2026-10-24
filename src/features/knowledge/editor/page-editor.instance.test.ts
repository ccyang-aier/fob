/**
 * Instance-level tests of the editor stack (E03) under happy-dom.
 *
 * These run the real assembly the React surface uses — the shared E01
 * registry extensions, the E02 blockId extension and the E03 collaboration
 * extension over real Y.Docs with the B08 undo controllers — against real
 * Tiptap Editor instances (no React, no network). What is proven end to end:
 * the schema the editor runs is the shared one, typing lands in the Y.Doc
 * page fragment (never component state), blockIds are minted by the E02
 * rules, undo follows the B08 human stack (including the repair/batch
 * reconciliation), two bound editors converge over the wire topology, and
 * the readonly decision reaches the ProseMirror view.
 */

import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { beforeAll, describe, expect, test } from 'bun:test';
import { Editor, getSchema } from '@tiptap/core';
import * as Y from 'yjs';
import { undo as yUndo, ySyncPluginKey } from 'y-prosemirror';
import { createBlockIdExtension, createKnowledgeExtensions, knowledgeSchema } from '@fob/shared/knowledge/schema';
import { connectPageDocument } from '../collaboration/page-provider';
import type { PageDocumentSession } from '../collaboration/page-provider';
import { createPageUndo } from '../collaboration/page-undo';
import type { PageUndo } from '../collaboration/page-undo';
import { pageCollaborationExtension } from './page-collaboration';

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

/** The exact extension assembly `PageEditorSurface` mounts, minus React. */
function editorExtensions(pageId: string, document: Y.Doc, pageUndo: PageUndo) {
  return [
    ...createKnowledgeExtensions(),
    createBlockIdExtension({ pageId }),
    pageCollaborationExtension(document, pageUndo),
  ];
}

function mountEditor(document: Y.Doc, pageUndo: PageUndo, editable = true): Editor {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  // happy-dom's element types are structurally thinner than the DOM lib's;
  // the instance is a real host element for Tiptap at runtime.
  return new Editor({ element: host as unknown as HTMLElement, editable, extensions: editorExtensions(scope.pageId, document, pageUndo) });
}

describe('editor stack under a real Tiptap instance', () => {
  test('the editor schema is the shared registry schema (no second schema)', () => {
    const document = new Y.Doc();
    const extensions = editorExtensions(scope.pageId, document, createPageUndo({ document }));
    const schema = getSchema(extensions);
    expect(Object.keys(schema.nodes).sort()).toEqual(Object.keys(knowledgeSchema.nodes).sort());
    expect(Object.keys(schema.marks).sort()).toEqual(Object.keys(knowledgeSchema.marks).sort());
    // Load-bearing node specs identical, not just the name lists.
    expect(JSON.stringify(schema.spec.nodes.get('doc'))).toBe(JSON.stringify(knowledgeSchema.spec.nodes.get('doc')));
    expect(JSON.stringify(schema.spec.nodes.get('callout'))).toBe(JSON.stringify(knowledgeSchema.spec.nodes.get('callout')));
  });

  test('typing lands in the Y.Doc page fragment with E02 blockIds; undo follows B08', () => {
    const document = new Y.Doc();
    const pageUndo = createPageUndo({ document, bindingOrigins: [ySyncPluginKey] });
    const editor = mountEditor(document, pageUndo);

    editor.commands.setContent('<h2>季度目标</h2><p>完成 AI 助手上线</p>');
    const fragment = document.getXmlFragment('default');
    const heading = fragment.get(0) as Y.XmlElement;
    expect(heading.nodeName).toBe('heading');
    expect(heading.getAttribute('level')).toBe(2);
    expect(typeof heading.getAttribute('blockId')).toBe('string');

    // The editor renders from the fragment: no second body state exists.
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.attrs.blockId).toBe(heading.getAttribute('blockId'));

    // Undo reverts this connection's own writing through the B08 human stack
    // — including block edits whose E02 repair closes the dispatch batch
    // (the reconciliation case; without it these writes skip the stack).
    expect(pageUndo.canUndo()).toBe(true);
    pageUndo.local.stopCapturing();
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>后续</p>');
    expect(fragment.length).toBe(3);
    expect(pageUndo.canUndo()).toBe(true);
    yUndo(editor.state); // the exact Mod-z path of the collaboration extension
    expect(fragment.length).toBe(2);
    pageUndo.redo();
    expect(fragment.length).toBe(3);
    pageUndo.undo();
    expect(fragment.length).toBe(2);
    pageUndo.undo(); // the first merged item covers the session's earlier writes
    expect(fragment.length).toBe(0);

    // A selection-only dispatch after undo (caret move, focus command) must
    // not clear the redo stack through the Y binding.
    pageUndo.redo();
    expect(fragment.length).toBe(2);
    editor.view.focus();
    editor.view.dispatch(editor.state.tr); // step-less, selection-only
    expect(pageUndo.canRedo()).toBe(true);
    pageUndo.redo();
    expect(fragment.length).toBe(3);
    editor.destroy();
  });

  test('two editors converge over the wire topology and keep undo isolated', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const undoA = createPageUndo({ document: docA, bindingOrigins: [ySyncPluginKey] });
    const undoB = createPageUndo({ document: docB, bindingOrigins: [ySyncPluginKey] });
    const a = mountEditor(docA, undoA);
    const b = mountEditor(docB, undoB);
    // Relay like the providers do: each side applies the peer's update with
    // the provider as origin — remote for the other connection's B08 stack.
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

    a.commands.insertContentAt(0, '<p>第一段</p>');
    expect(b.state.doc.textContent).toContain('第一段');
    // The remote write must not enter the other connection's undo stack.
    expect(undoB.canUndo()).toBe(false);

    b.commands.insertContentAt(b.state.doc.content.size, '<p>第二段</p>');
    expect(a.state.doc.textContent).toContain('第二段');
    expect(undoA.canUndo()).toBe(true);
    expect(undoB.canUndo()).toBe(true);
    undoB.undo();
    expect(a.state.doc.textContent).not.toContain('第二段');
    expect(a.state.doc.textContent).toContain('第一段');
    b.destroy();
    a.destroy();
  });

  test('readonly reaches the ProseMirror view', () => {
    const document = new Y.Doc();
    const pageUndo = createPageUndo({ document, bindingOrigins: [ySyncPluginKey] });
    const editor = mountEditor(document, pageUndo, false);
    expect(editor.isEditable).toBe(false);
    editor.setEditable(true);
    expect(editor.isEditable).toBe(true);
    editor.destroy();
  });

  test('a real B04 offline session feeds the same binding (backend unreachable)', async () => {
    // The real page-provider session from B04: the local copy loads (empty
    // here, on fake-indexeddb), the connection attempt fails against an
    // unreachable origin, and the binding still writes into the session doc.
    const session: PageDocumentSession = connectPageDocument({
      scope,
      origin: 'http://127.0.0.1:1',
      WebSocketPolyfill: class {
        close(): void {}
        addEventListener(): void {}
        removeEventListener(): void {}
        send(): void {}
      },
      loadTimeoutMs: 50,
    });
    const pageUndo = createPageUndo({ document: session.document, bindingOrigins: [ySyncPluginKey] });
    const editor = mountEditor(session.document, pageUndo);
    editor.commands.insertContentAt(0, '<p>离线可编辑</p>');
    expect(session.document.getXmlFragment('default').toString()).toContain('离线可编辑');
    // The B04 status machine reaches its local-ready state on its own clock.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(session.getStatus().localReady).toBe(true);
    editor.destroy();
    void session.destroy();
  });
});
