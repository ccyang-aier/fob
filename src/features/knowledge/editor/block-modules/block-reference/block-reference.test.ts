/**
 * Unit tests of the block reference source layer (L02): the refcounted
 * source-page connection cache (sharing, release-to-zero teardown, failure
 * rejection with retry), the deep block locator, the subtree renderer and the
 * pure view-state derivation. Fully offline — connections are injected.
 */

import { Window } from 'happy-dom';
import { beforeAll, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import type { PageDocumentSession } from '../../../collaboration/page-provider';
import type { PageDocumentStatus } from '../../../collaboration/page-sync-state';
import {
  createBlockReferenceSources,
  locateSourceBlock,
  renderSourceBlock,
  resolveBlockReferenceState,
  watchSourceBlock,
} from './block-reference-source';
import type { BlockReferenceSources, SourceConnector } from './block-reference-source';

const synced: PageDocumentStatus = { phase: 'synced', localReady: true, cloudPending: false };
const localOnly: PageDocumentStatus = { phase: 'local-only', localReady: true, cloudPending: false };

let window: Window;

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

const scopeA: PageScope = { knowledgeBaseId: '00000000-0000-4000-8000-000000000001', pageId: '00000000-0000-4000-8000-00000000000a' };
const scopeB: PageScope = { knowledgeBaseId: '00000000-0000-4000-8000-000000000001', pageId: '00000000-0000-4000-8000-00000000000b' };
const ownScope: PageScope = { knowledgeBaseId: scopeA.knowledgeBaseId, pageId: '00000000-0000-4000-8000-00000000000f' };

/** Session fake: a real Y.Doc plus counted connects/destroys. */
function fakeConnector() {
  const calls = { connects: 0, destroys: 0 };
  const documents: Y.Doc[] = [];
  const sessions: PageDocumentSession[] = [];
  const connect: SourceConnector = ({ scope }) => {
    calls.connects++;
    const document = new Y.Doc();
    documents.push(document);
    const session: PageDocumentSession = {
      scope,
      document,
      awareness: null,
      getStatus: () => synced,
      subscribe: () => () => {},
      destroy: () => {
        calls.destroys++;
        document.destroy();
        return Promise.resolve();
      },
    };
    sessions.push(session);
    return Promise.resolve(session);
  };
  return { calls, documents, sessions, connect };
}

describe('block reference source cache', () => {
  test('the same page ID in two knowledge bases never shares a body session', async () => {
    const fake = fakeConnector();
    const scopes: PageScope[] = [];
    const sources = createBlockReferenceSources({ origin: 'https://fob.test', connect: fake.connect, authorize: async scope => { scopes.push(scope); } });
    const foreignScope = { ...scopeA, knowledgeBaseId: '00000000-0000-4000-8000-000000000009' };
    const [first, second] = await Promise.all([sources.acquire(scopeA), sources.acquire(foreignScope)]);
    expect(scopes).toEqual([scopeA, foreignScope]);
    expect(fake.calls.connects).toBe(2);
    expect(first.document === second.document).toBe(false);
    await first.release();
    await second.release();
  });
  test('a denied target never opens its offline body or collaboration session', async () => {
    const fake = fakeConnector();
    let authorizedScope: PageScope | undefined;
    const sources = createBlockReferenceSources({ origin: 'https://fob.test', connect: fake.connect,
      authorize: async scope => { authorizedScope = scope; throw new Error('denied'); },
    });
    const foreignScope = { knowledgeBaseId: '00000000-0000-4000-8000-000000000009', pageId: scopeA.pageId };
    const result = await Promise.allSettled([sources.acquire(foreignScope)]);
    expect(result[0].status).toBe('rejected');
    expect(authorizedScope).toEqual(foreignScope);
    expect(fake.calls.connects).toBe(0);
    expect(fake.documents).toHaveLength(0);
  });
  test('sequential acquires share one session; the last release destroys it', async () => {
    const fake = fakeConnector();
    const sources: BlockReferenceSources = createBlockReferenceSources({ origin: 'https://fob.test', authorize: async () => {}, connect: fake.connect });

    const first = await sources.acquire(scopeA);
    const second = await sources.acquire(scopeA);
    expect(fake.calls.connects).toBe(1);
    expect(second.document).toBe(first.document);

    await first.release();
    expect(fake.calls.destroys).toBe(0);

    await second.release();
    expect(fake.calls.destroys).toBe(1);
  });

  test('concurrent acquires share one connector call', async () => {
    const fake = fakeConnector();
    const sources = createBlockReferenceSources({ origin: 'https://fob.test', authorize: async () => {}, connect: fake.connect });
    const [a, b] = await Promise.all([sources.acquire(scopeA), sources.acquire(scopeA)]);
    expect(fake.calls.connects).toBe(1);
    expect(a.document).toBe(b.document);
    await a.release();
    await b.release();
    expect(fake.calls.destroys).toBe(1);
  });

  test('different pages get independent sessions', async () => {
    const fake = fakeConnector();
    const sources = createBlockReferenceSources({ origin: 'https://fob.test', authorize: async () => {}, connect: fake.connect });
    const [a, b] = await Promise.all([sources.acquire(scopeA), sources.acquire(scopeB)]);
    expect(fake.calls.connects).toBe(2);
    expect(a.document).not.toBe(b.document);
    await a.release();
    expect(fake.calls.destroys).toBe(1);
    await b.release();
    expect(fake.calls.destroys).toBe(2);
  });

  test('connector failures reject every waiter once and a later acquire retries', async () => {
    let failing = true;
    const fake = fakeConnector();
    const connect: SourceConnector = (options) => (failing ? Promise.reject(new Error('unreachable')) : fake.connect(options));
    const sources = createBlockReferenceSources({ origin: 'https://fob.test', authorize: async () => {}, connect });

    const [first, second] = await Promise.allSettled([sources.acquire(scopeA), sources.acquire(scopeA)]);
    expect(first.status).toBe('rejected');
    expect(second.status).toBe('rejected');
    // The slot was cleared — the next acquire opens a fresh connection.
    failing = false;
    const handle = await sources.acquire(scopeA);
    expect(handle.document).toBe(fake.documents[0]);
    await handle.release();
  });

  test('release resolves after the session destroy settled', async () => {
    let destroyed = false;
    const connect: SourceConnector = ({ scope }) =>
      Promise.resolve<PageDocumentSession>({
        scope,
        document: new Y.Doc(),
        awareness: null,
        getStatus: () => synced,
        subscribe: () => () => {},
        destroy: () => new Promise<void>((resolve) => {
          setTimeout(() => {
            destroyed = true;
            resolve();
          }, 10);
        }),
      });
    const sources = createBlockReferenceSources({ origin: 'https://fob.test', authorize: async () => {}, connect });
    const handle = await sources.acquire(scopeA);
    await handle.release();
    expect(destroyed).toBe(true);
  });
});

/** A body with nested containers mirrors real pages (callout > paragraph, columns > column > heading). */
function nestedBody(): Y.Doc {
  return prosemirrorJSONToYDoc(knowledgeSchema, {
    type: 'doc',
    content: [
      {
        type: 'callout',
        attrs: { emoji: '💡', tone: 'neutral', blockId: 'blk-callout' },
        content: [
          { type: 'paragraph', attrs: { blockId: 'blk-plain' }, content: [{ type: 'text', text: '外层' }] },
        ],
      },
      {
        type: 'columns',
        attrs: { blockId: 'blk-cols' },
        content: [
          {
            type: 'column',
            attrs: { width: 1, blockId: 'blk-col-a' },
            content: [{ type: 'paragraph', attrs: { blockId: 'blk-col-para' }, content: [{ type: 'text', text: '左栏' }] }],
          },
          {
            type: 'column',
            attrs: { width: 1, blockId: 'blk-col' },
            content: [
              { type: 'heading', attrs: { level: 3, blockId: 'blk-head' }, content: [{ type: 'text', text: '深处标题' }] },
            ],
          },
        ],
      },
      { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: '无 ID 段落' }] },
    ],
  }, 'default');
}

describe('locateSourceBlock', () => {
  test('finds deeply nested blocks and rejects invalid ids', () => {
    const fragment = nestedBody().getXmlFragment('default');
    expect(locateSourceBlock(fragment, 'blk-plain')?.nodeName).toBe('paragraph');
    expect(locateSourceBlock(fragment, 'blk-head')?.nodeName).toBe('heading');
    expect(locateSourceBlock(fragment, 'blk-callout')?.nodeName).toBe('callout');
    expect(locateSourceBlock(fragment, 'missing')).toBeNull();
    expect(locateSourceBlock(fragment, 'bad#id')).toBeNull();
  });
});

describe('renderSourceBlock', () => {
  test('serializes exactly the located subtree through the shared schema', () => {
    const document = nestedBody();
    const fragment = document.getXmlFragment('default');
    const heading = locateSourceBlock(fragment, 'blk-head');
    const dom = heading ? renderSourceBlock(heading, knowledgeSchema) : null;
    expect(dom?.matches('h3')).toBe(true);
    expect(dom?.textContent).toBe('深处标题');
  });

  test('returns null when the element has no valid blockId', () => {
    const fragment = nestedBody().getXmlFragment('default');
    const plain = fragment.get(0) as Y.XmlElement; // the callout
    const para = plain.toArray()[0] as Y.XmlElement;
    expect(renderSourceBlock(para, knowledgeSchema)?.textContent).toBe('外层');
    const anonymous = new Y.XmlElement('paragraph');
    expect(renderSourceBlock(anonymous, knowledgeSchema)).toBeNull();
  });
});

describe('resolveBlockReferenceState', () => {
  const base = {
    attrs: { knowledgeBaseId: scopeA.knowledgeBaseId, pageId: scopeA.pageId as string | null, targetBlockId: 'blk-head' as string | null },
    ownScope,
    element: null as Y.XmlElement | null,
  };

  test('cyclic and unconfigured are decided before any connection', () => {
    expect(resolveBlockReferenceState({ ...base, attrs: { ...base.attrs, pageId: ownScope.pageId }, sessionStatus: null })).toBe('cyclic');
    expect(resolveBlockReferenceState({ ...base, attrs: { knowledgeBaseId: scopeA.knowledgeBaseId, pageId: null, targetBlockId: 'blk' }, sessionStatus: null })).toBe('unconfigured');
    expect(resolveBlockReferenceState({ ...base, attrs: { knowledgeBaseId: scopeA.knowledgeBaseId, pageId: scopeA.pageId, targetBlockId: null }, sessionStatus: null })).toBe('unconfigured');
    expect(resolveBlockReferenceState({ ...base, attrs: { ...base.attrs, knowledgeBaseId: null }, sessionStatus: null })).toBe('unconfigured');
    expect(resolveBlockReferenceState({ ...base, attrs: { ...base.attrs, knowledgeBaseId: 'another-base', pageId: ownScope.pageId }, sessionStatus: synced, element: new Y.XmlElement('heading') })).toBe('live');
  });

  test('connector failure and auth denial map to their own states', () => {
    expect(resolveBlockReferenceState({ ...base, sessionStatus: null, connectFailed: true })).toBe('failed');
    expect(resolveBlockReferenceState({ ...base, sessionStatus: { phase: 'error', localReady: true, cloudPending: false, errorReason: 'denied' } })).toBe('denied');
  });

  test('pre-sync phases stay loading (the local copy may still render), sync settles live/deleted', () => {
    const element = new Y.XmlElement('heading');
    expect(resolveBlockReferenceState({ ...base, sessionStatus: { phase: 'local-only', localReady: false, cloudPending: false } })).toBe('loading');
    expect(resolveBlockReferenceState({ ...base, sessionStatus: localOnly, element })).toBe('loading');
    expect(resolveBlockReferenceState({ ...base, sessionStatus: { phase: 'syncing', localReady: true, cloudPending: true }, element })).toBe('loading');
    expect(resolveBlockReferenceState({ ...base, sessionStatus: synced, element })).toBe('live');
    expect(resolveBlockReferenceState({ ...base, sessionStatus: synced, element: null })).toBe('deleted');
    // Offline after sync: the local copy is the freshest state this client has.
    expect(resolveBlockReferenceState({ ...base, sessionStatus: { phase: 'offline', localReady: true, cloudPending: false }, element })).toBe('live');
    expect(resolveBlockReferenceState({ ...base, sessionStatus: { phase: 'offline', localReady: true, cloudPending: false }, element: null })).toBe('deleted');
  });
});

describe('watchSourceBlock', () => {
  function openWatch(document: Y.Doc, targetBlockId: string, throttleMs = 0) {
    return watchSourceBlock({
      fragment: document.getXmlFragment('default'),
      attrs: { knowledgeBaseId: scopeA.knowledgeBaseId, pageId: scopeA.pageId, targetBlockId },
      ownScope,
      status: () => synced,
      schema: knowledgeSchema,
      throttleMs,
    });
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

  test('renders the located block and follows relevant changes on the throttle', async () => {
    const document = nestedBody();
    const watch = openWatch(document, 'blk-head');
    expect(watch.snapshot().dom?.matches('h3')).toBe(true);
    expect(watch.snapshot().dom?.textContent).toBe('深处标题');

    let notified = 0;
    watch.subscribe(() => notified++);

    const callout = document.getXmlFragment('default').get(0) as Y.XmlElement;
    const paragraph = callout.toArray()[0] as Y.XmlElement;
    const text = paragraph.toArray()[0] as Y.XmlText;
    document.transact(() => {
      text.delete(0, text.length);
      text.insert(0, '无关改动');
    });
    await flush();
    expect(notified).toBe(0); // changes outside the located subtree never reconvert

    const heading = locateSourceBlock(document.getXmlFragment('default'), 'blk-head')!;
    const headingText = heading.toArray()[0] as Y.XmlText;
    document.transact(() => {
      headingText.delete(0, headingText.length);
      headingText.insert(0, '改后的标题');
    });
    await flush();
    expect(notified).toBe(1);
    expect(watch.snapshot().dom?.textContent).toBe('改后的标题');
    watch.dispose();
  });

  test('removal of the target flips the snapshot to deleted and stops observing after dispose', async () => {
    const document = nestedBody();
    const watch = openWatch(document, 'blk-head');
    expect(watch.snapshot().state).toBe('live');

    const fragment = document.getXmlFragment('default');
    document.transact(() => fragment.delete(1, 1)); // removes the whole columns block
    await flush();
    expect(watch.snapshot().state).toBe('deleted');
    expect(watch.snapshot().dom).toBeNull();

    watch.dispose();
    document.transact(() => fragment.insert(0, [new Y.XmlElement('paragraph')]));
    await flush();
    // Disposed: no late timer can resurrect notifications.
    expect(watch.snapshot().state).toBe('deleted');
  });
});
