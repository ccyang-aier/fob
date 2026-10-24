/**
 * Instance-level tests of the block reference card (L02) under happy-dom: a
 * real Tiptap Editor whose registry `blockReference` node renders the real
 * React NodeView over a source page document built by y-prosemirror, with the
 * connection injected (offline). What is proven end to end: the live card
 * renders the source block's schema-serialized DOM, source updates repaint
 * through the throttle, source deletion flips to the deleted state, cyclic
 * references never open a connection, clicks publish open targets, and the
 * reveal flash lands on the right editor DOM node.
 */

import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { createBlockIdExtension, createKnowledgeExtensions, knowledgeSchema } from '@fob/shared/knowledge/schema';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import type { PageDocumentSession } from '../../../collaboration/page-provider';
import { subscribeOpenPageTarget } from '../../open-target';
import type { OpenPageTarget } from '../../open-target';
import { revealBlockInEditor } from '../../open-target';
import { createBlockReferenceSources } from './block-reference-source';
import type { BlockReferenceSources, SourceConnector } from './block-reference-source';
import { applyBlockReferenceView } from './block-reference';
import { KnowledgeDataError } from '../../../data/errors';

const scope: PageScope = { knowledgeBaseId: '00000000-0000-4000-8000-000000000001', pageId: '00000000-0000-4000-8000-000000000002' };
const sourcePageId = '00000000-0000-4000-8000-000000000003';

/** The local bun:test ambient types omit bun's third-argument timeout; the runtime supports it. */
const testWithTimeout = test as unknown as (name: string, fn: () => void | Promise<void>, timeoutMs?: number) => void;

let window: Window;
const disposers: (() => void)[] = [];

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame', 'Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent']) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

afterAll(() => {
  window.close();
});

/** React commits, the acquire microtask and the 0ms throttle all settle here. */
const flush = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
};

function sourceBody(): Y.Doc {
  return prosemirrorJSONToYDoc(knowledgeSchema, {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2, blockId: 'src-heading' }, content: [{ type: 'text', text: '季度目标' }] },
      { type: 'paragraph', attrs: { blockId: 'src-para' }, content: [{ type: 'text', text: '完成 AI 助手上线' }] },
    ],
  }, 'default');
}

interface SourceFixture {
  sources: BlockReferenceSources;
  document: Y.Doc;
  calls: { connects: number; destroys: number; scopes: PageScope[] };
}

/** The B04 session contract over the prepared source doc, with counted lifecycle. */
function sourceFixture(document: Y.Doc, authorize: (target: PageScope) => Promise<void> = async () => {}): SourceFixture {
  const calls = { connects: 0, destroys: 0, scopes: [] as PageScope[] };
  const connect: SourceConnector = ({ scope: target }) => {
    calls.connects++;
    calls.scopes.push(target);
    const session: PageDocumentSession = {
      scope: target,
      document,
      awareness: null,
      getStatus: () => ({ phase: 'synced', localReady: true, cloudPending: false }),
      subscribe: () => () => {},
      destroy: () => {
        calls.destroys++;
        return Promise.resolve();
      },
    };
    return Promise.resolve(session);
  };
  return { sources: createBlockReferenceSources({ origin: 'https://fob.test', authorize, connect }), document, calls };
}

function mountEditor(fixture: SourceFixture): Editor {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const host = window.document.createElement('div');
  container.appendChild(host);
  const extensions = applyBlockReferenceView(
    [...createKnowledgeExtensions(), createBlockIdExtension({ pageId: scope.pageId })],
    { scope, origin: 'https://fob.test', sources: fixture.sources, throttleMs: 0 },
  );
  const editor = new Editor({ element: host as unknown as HTMLElement, extensions });
  // The React shell that activates ReactNodeViewRenderer's portals.
  const root: Root = createRoot(container as unknown as HTMLElement);
  root.render(createElement(EditorContent, { editor }));
  disposers.push(() => {
    root.unmount();
    editor.destroy();
    container.remove();
  });
  return editor;
}

function insertReference(editor: Editor, attrs: { knowledgeBaseId: string | null; pageId: string | null; targetBlockId: string | null }): void {
  expect(editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'blockReference', attrs })).toBe(true);
}

function card(editor: Editor, state: string): HTMLElement | null {
  return editor.view.dom.querySelector(`[data-block-reference="${state}"]`);
}

describe('block reference card in a real editor', () => {
  testWithTimeout('changing the target clears the old body before its new ACL settles', async () => {
    let rejectTarget: (cause: Error) => void = () => {};
    const foreignBaseId = '00000000-0000-4000-8000-000000000009';
    const fixture = sourceFixture(sourceBody(), target => target.knowledgeBaseId === foreignBaseId
      ? new Promise((_, reject) => { rejectTarget = reject; }) : Promise.resolve());
    const editor = mountEditor(fixture);
    insertReference(editor, { knowledgeBaseId: scope.knowledgeBaseId, pageId: sourcePageId, targetBlockId: 'src-heading' });
    await flush();
    expect(card(editor, 'live')?.querySelector('h2')?.textContent).toBe('季度目标');
    editor.commands.updateAttributes('blockReference', { knowledgeBaseId: foreignBaseId });
    await flush();
    expect(card(editor, 'live')).toBeNull();
    expect(Boolean(card(editor, 'loading')?.querySelector('h2'))).toBe(false);
    rejectTarget(new KnowledgeDataError('FORBIDDEN'));
    await flush();
    expect(card(editor, 'denied')?.textContent).toContain('无权访问来源页');
    expect(fixture.calls.connects).toBe(1);
  }, 15_000);
  testWithTimeout('cross-knowledge-base references load and navigate the explicit target resource', async () => {
    const fixture = sourceFixture(sourceBody());
    const editor = mountEditor(fixture);
    const targetScope = { knowledgeBaseId: '00000000-0000-4000-8000-000000000009', pageId: sourcePageId };
    insertReference(editor, { ...targetScope, targetBlockId: 'src-heading' });
    await flush();
    expect(fixture.calls.scopes).toEqual([targetScope]);
    expect(card(editor, 'live')?.querySelector('h2')?.textContent).toBe('季度目标');
    let opened: OpenPageTarget | undefined;
    const unsubscribe = subscribeOpenPageTarget(target => { opened = target; });
    card(editor, 'live')?.querySelector('[role="button"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
    unsubscribe();
    expect(opened).toEqual({ ...targetScope, blockId: 'src-heading' });
  }, 15_000);
  testWithTimeout('a live card renders the source block through the shared schema', async () => {
    const fixture = sourceFixture(sourceBody());
    const editor = mountEditor(fixture);
    insertReference(editor, { knowledgeBaseId: scope.knowledgeBaseId, pageId: sourcePageId, targetBlockId: 'src-heading' });
    await flush();

    const live = card(editor, 'live');
    expect(live).not.toBeNull();
    expect(live?.querySelector('h2')?.textContent).toBe('季度目标');
    expect(fixture.calls.connects).toBe(1);
    expect(live?.textContent).toContain('跳转到原文');
  }, 15_000);

  testWithTimeout('source edits repaint the card through the throttle; deletion flips to deleted', async () => {
    const fixture = sourceFixture(sourceBody());
    const editor = mountEditor(fixture);
    insertReference(editor, { knowledgeBaseId: scope.knowledgeBaseId, pageId: sourcePageId, targetBlockId: 'src-heading' });
    await flush();
    expect(card(editor, 'live')?.querySelector('h2')?.textContent).toBe('季度目标');

    const heading = fixture.document.getXmlFragment('default').get(0) as Y.XmlElement;
    const text = heading.toArray()[0] as Y.XmlText;
    fixture.document.transact(() => {
      text.delete(0, text.length);
      text.insert(0, '新的目标');
    });
    await flush();
    expect(card(editor, 'live')?.querySelector('h2')?.textContent).toBe('新的目标');

    fixture.document.transact(() => fixture.document.getXmlFragment('default').delete(0, 1));
    await flush();
    const deleted = card(editor, 'deleted');
    expect(deleted).not.toBeNull();
    expect(deleted?.textContent).toContain('来源块已删除');
    expect(card(editor, 'live')).toBeNull();
  }, 15_000);

  testWithTimeout('a cyclic reference renders without the connector ever being called', async () => {
    const fixture = sourceFixture(sourceBody());
    const editor = mountEditor(fixture);
    insertReference(editor, { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, targetBlockId: 'src-heading' });
    await flush();

    const cyclic = card(editor, 'cyclic');
    expect(cyclic).not.toBeNull();
    expect(cyclic?.textContent).toContain('循环引用：来源是当前页面');
    expect(fixture.calls.connects).toBe(0);
  }, 15_000);

  testWithTimeout('an unconfigured reference renders its placeholder without connecting', async () => {
    const fixture = sourceFixture(sourceBody());
    const editor = mountEditor(fixture);
    insertReference(editor, { knowledgeBaseId: scope.knowledgeBaseId, pageId: null, targetBlockId: null });
    await flush();

    expect(card(editor, 'picker')?.textContent).toContain('引用文档内容');
    expect(fixture.calls.connects).toBe(0);
  }, 15_000);

  testWithTimeout('clicking a live card publishes the open target and stages the highlight', async () => {
    const fixture = sourceFixture(sourceBody());
    const editor = mountEditor(fixture);
    insertReference(editor, { knowledgeBaseId: scope.knowledgeBaseId, pageId: sourcePageId, targetBlockId: 'src-heading' });
    await flush();
    const live = card(editor, 'live');
    expect(live).not.toBeNull();

    const seen: OpenPageTarget[] = [];
    const stop = subscribeOpenPageTarget((target) => seen.push(target));
    const button = live?.querySelector('[role="button"]');
    expect(button).not.toBeNull();
    // happy-dom's event types are structurally thinner than the DOM lib's.
    button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
    stop();

    expect(seen).toEqual([{ knowledgeBaseId: scope.knowledgeBaseId, pageId: sourcePageId, blockId: 'src-heading' }]);
  }, 15_000);

  testWithTimeout('unmounting the card releases the shared source session', async () => {
    const fixture = sourceFixture(sourceBody());
    const editor = mountEditor(fixture);
    insertReference(editor, { knowledgeBaseId: scope.knowledgeBaseId, pageId: sourcePageId, targetBlockId: 'src-heading' });
    await flush();
    expect(fixture.calls.connects).toBe(1);
    expect(fixture.calls.destroys).toBe(0);

    const dispose = disposers.pop();
    dispose?.();
    await flush();
    expect(fixture.calls.destroys).toBe(1);
  }, 15_000);

  testWithTimeout('revealBlockInEditor flashes the referenced block in the editor DOM', async () => {
    const fixture = sourceFixture(sourceBody());
    const editor = mountEditor(fixture);
    expect(editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'blk-own' }, content: [{ type: 'text', text: '本页段落' }] },
      ],
    }) as boolean).toBe(true);
    await flush();

    expect(revealBlockInEditor(editor.view, 'blk-own')).toBe(true);
    const paragraph = editor.view.dom.querySelector('p');
    expect(paragraph?.classList.contains('fob-block-flash')).toBe(true);
    expect(revealBlockInEditor(editor.view, 'src-heading')).toBe(false);
  }, 15_000);
});
