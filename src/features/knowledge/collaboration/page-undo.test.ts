/**
 * Page-level undo coordination against the real kernel (B00) and the real
 * page session lifecycle (B04).
 *
 * Covered: the local human stack only ever contains this connection's own
 * writes (peers', agents', MCP and restore updates stay untouched, online
 * or fully offline); every AI/MCP task origin reverts and restores as one
 * unit across blocks, transactions and capture boundaries without
 * disturbing the human stack (redo stacks included); human redo follows
 * the standard editor semantics; destroy — explicit or through the page
 * session's document teardown — clears every stack and listener; and undo
 * works with no network at all, counting as a local edit for the B04
 * status machine.
 */
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  agentOrigin,
  humanOrigin,
  mcpOrigin,
  restoreOrigin,
} from '@fob/shared/knowledge/collaboration';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { connectPageDocument } from './page-provider';
import { createPageUndo } from './page-undo';

function write(document: Y.Doc, text: Y.Text, value: string, origin: string | object): void {
  document.transact(() => text.insert(text.length, value), origin);
}

function addParagraph(document: Y.Doc, content: Y.XmlFragment, blockId: string, text: string, origin: string | object): void {
  document.transact(() => {
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.setAttribute('blockId', blockId);
    paragraph.insert(0, [new Y.XmlText(text)]);
    content.insert(content.length, [paragraph]);
  }, origin);
}

function blockIds(content: Y.XmlFragment): string[] {
  return Array.from({ length: content.length }, (_, index) => {
    return (content.get(index) as Y.XmlElement).getAttribute('blockId') as string;
  });
}

/** Distinct document events with live listeners; the honest version of B04's teardown probe. */
function observerEventCount(document: Y.Doc): number {
  return (document as unknown as { _observers: Map<string, Set<unknown>> })._observers.size;
}

describe('local human undo isolation', () => {
  test("peers', agents', MCP and restore updates never enter the human stack", () => {
    const document = new Y.Doc();
    const pageUndo = createPageUndo({ document, clientId: 'window_a' });
    const text = document.getText('content');

    // Other humans and agents write elsewhere; their updates arrive as
    // remote data, under an origin the wire would never even carry.
    const remote = new Y.Doc();
    write(remote, remote.getText('content'), 'other human/', humanOrigin('window_b'));
    write(remote, remote.getText('content'), 'agent/', agentOrigin('task_remote'));
    Y.applyUpdate(document, Y.encodeStateAsUpdate(remote), 'network');
    expect(pageUndo.canUndo()).toBe(false);

    // Foreign origins on this very connection are local transactions, but
    // still not this connection's human.
    write(document, text, 'local agent/', agentOrigin('task_local'));
    write(document, text, 'restore/', restoreOrigin('checkpoint'));
    expect(pageUndo.canUndo()).toBe(false);

    // A provider replaying an update under an identical origin label must
    // not sneak into the human stack either (kernel: remote ≠ tracked).
    const echo = new Y.Doc();
    Y.applyUpdate(echo, Y.encodeStateAsUpdate(document), 'network');
    write(echo, echo.getText('content'), 'echo/', humanOrigin('window_a'));
    Y.applyUpdate(document, Y.encodeStateAsUpdate(echo, Y.encodeStateVector(document)), pageUndo.origin);
    expect(pageUndo.canUndo()).toBe(false);

    write(document, text, 'mine/', pageUndo.origin);
    expect(text.toString()).toBe('other human/agent/local agent/restore/echo/mine/');
    expect(pageUndo.undo()).toBe(true);
    expect(text.toString()).toBe('other human/agent/local agent/restore/echo/');
    expect(pageUndo.canUndo()).toBe(false);
    expect(pageUndo.redo()).toBe(true);
    expect(text.toString()).toBe('other human/agent/local agent/restore/echo/mine/');
    document.destroy();
  });
});

describe('whole AI task undo', () => {
  test('one task reverts and restores as a single unit across blocks, transactions and capture boundaries', () => {
    const document = new Y.Doc();
    const pageUndo = createPageUndo({ document, clientId: 'window_a' });
    const content = document.getXmlFragment('content');
    addParagraph(document, content, 'human_block', 'human base', pageUndo.origin);

    const task = pageUndo.task(agentOrigin('task_report'));
    addParagraph(document, content, 'ai_intro', 'introduction', task.origin);
    document.transact(() => {
      (content.get(0) as Y.XmlElement).setAttribute('sourceBlockId', 'ai_proof');
    }, task.origin);
    addParagraph(document, content, 'human_after', 'human later', pageUndo.origin);
    addParagraph(document, content, 'ai_outro', 'conclusion', task.origin);
    // Streaming finished; a late straggler still belongs to the same task.
    task.end();
    addParagraph(document, content, 'ai_extra', 'late fix', task.origin);

    expect(task.undo()).toBe(true);
    expect(blockIds(content)).toEqual(['human_block', 'human_after']);
    expect((content.get(0) as Y.XmlElement).getAttribute('sourceBlockId')).toBe(undefined);
    // The human stack — including redo state — survives the task undo.
    expect(pageUndo.canUndo()).toBe(true);
    expect(task.canUndo()).toBe(false);

    expect(task.redo()).toBe(true);
    expect(blockIds(content)).toEqual(['human_block', 'ai_intro', 'human_after', 'ai_outro', 'ai_extra']);
    expect((content.get(0) as Y.XmlElement).getAttribute('sourceBlockId')).toBe('ai_proof');
    document.destroy();
  });

  test('task origins are independent of each other and of the human redo stack', () => {
    const document = new Y.Doc();
    const pageUndo = createPageUndo({ document, clientId: 'window_a' });
    const text = document.getText('content');
    const a = pageUndo.task(agentOrigin('task_a'));
    const b = pageUndo.task(agentOrigin('task_b'));
    const tool = pageUndo.task(mcpOrigin('Cursor', 'call_fix'));
    expect(pageUndo.taskOrigins).toEqual([agentOrigin('task_a'), agentOrigin('task_b'), mcpOrigin('Cursor', 'call_fix')]);

    write(document, text, 'A/', a.origin);
    write(document, text, 'H/', pageUndo.origin);
    write(document, text, 'B/', b.origin);
    write(document, text, 'M/', tool.origin);

    expect(a.undo()).toBe(true);
    expect(text.toString()).toBe('H/B/M/');
    expect(a.canUndo()).toBe(false);
    expect(pageUndo.task(agentOrigin('task_a')).canUndo()).toBe(false); // same origin, same unit
    expect(b.canUndo() && tool.canUndo() && pageUndo.canUndo()).toBe(true);

    expect(pageUndo.undo()).toBe(true);
    expect(text.toString()).toBe('B/M/');
    expect(pageUndo.canRedo()).toBe(true);
    expect(b.undo()).toBe(true);
    expect(tool.undo()).toBe(true);
    expect(text.toString()).toBe('');
    // Task undos did not clear the human redo stack.
    expect(pageUndo.redo()).toBe(true);
    expect(text.toString()).toBe('H/');
    expect(a.redo()).toBe(true);
    expect(text.toString()).toBe('A/H/');
    document.destroy();
  });
});

describe('human redo semantics', () => {
  test('redo restores undo steps in order; a fresh edit clears the redo stack', () => {
    const document = new Y.Doc();
    const pageUndo = createPageUndo({ document, clientId: 'window_a', captureTimeoutMs: 0 });
    const text = document.getText('content');
    write(document, text, 'one ', pageUndo.origin);
    write(document, text, 'two ', pageUndo.origin);

    expect(pageUndo.undo()).toBe(true);
    expect(text.toString()).toBe('one ');
    expect(pageUndo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(pageUndo.canUndo()).toBe(false);
    expect(pageUndo.redo()).toBe(true);
    expect(text.toString()).toBe('one ');
    expect(pageUndo.redo()).toBe(true);
    expect(text.toString()).toBe('one two ');

    write(document, text, 'new ', pageUndo.origin);
    expect(pageUndo.canRedo()).toBe(false);
    expect(pageUndo.undo()).toBe(true);
    expect(text.toString()).toBe('one two ');
    document.destroy();
  });
});

describe('destroy', () => {
  test('explicit destroy clears both stacks and detaches every listener', () => {
    const document = new Y.Doc();
    const baseline = observerEventCount(document); // a fresh Y.Doc keeps its own "load"/"sync"
    const pageUndo = createPageUndo({ document, clientId: 'window_a' });
    const text = document.getText('content');
    const task = pageUndo.task(agentOrigin('task_a'));
    write(document, text, 'mine/', pageUndo.origin);
    write(document, text, 'ai/', task.origin);
    expect(pageUndo.canUndo() && task.canUndo()).toBe(true);
    expect(observerEventCount(document)).toBeGreaterThan(baseline);

    pageUndo.destroy();
    pageUndo.destroy(); // idempotent
    expect(pageUndo.local.undoStack).toHaveLength(0);
    expect(pageUndo.local.redoStack).toHaveLength(0);
    expect(task.canUndo()).toBe(false);
    expect(observerEventCount(document)).toBe(baseline);
    // Writes after teardown are not captured, and undo/redo are inert.
    write(document, text, 'after/', pageUndo.origin);
    expect(pageUndo.canUndo()).toBe(false);
    expect(pageUndo.undo()).toBe(false);
    expect(() => pageUndo.task(agentOrigin('task_b'))).toThrow();
    document.destroy();
  });

  test('destroying the page document (session teardown) clears the stacks automatically', () => {
    const document = new Y.Doc();
    const pageUndo = createPageUndo({ document, clientId: 'window_a' });
    const task = pageUndo.task(agentOrigin('task_a'));
    write(document, document.getText('content'), 'mine/', pageUndo.origin);
    write(document, document.getText('content'), 'ai/', task.origin);

    document.destroy();
    expect(pageUndo.local.undoStack).toHaveLength(0);
    expect(task.canUndo()).toBe(false);
    expect(() => pageUndo.task(agentOrigin('task_b'))).toThrow();
    pageUndo.destroy(); // must stay idempotent afterwards
  });
});

describe('offline page session', () => {
  type SocketEvent = { code?: number; reason?: string };

  /** The backend never becomes reachable: every attempt dies immediately. */
  class UnreachableSocket {
    binaryType = 'arraybuffer';
    readyState = 0;
    private readonly handlers = new Map<string, Set<(event: SocketEvent) => void>>();
    constructor() {
      queueMicrotask(() => {
        this.readyState = 3;
        this.emit('close', { code: 1006 });
      });
    }
    addEventListener(name: string, handler: (event: SocketEvent) => void): void {
      const set = this.handlers.get(name) ?? new Set();
      set.add(handler);
      this.handlers.set(name, set);
    }
    removeEventListener(name: string, handler: (event: SocketEvent) => void): void {
      this.handlers.get(name)?.delete(handler);
    }
    send(): void {}
    close(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close', { code: 1000 });
    }
    private emit(name: string, event: SocketEvent): void {
      for (const handler of [...(this.handlers.get(name) ?? [])]) handler(event);
    }
  }

  const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

  async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    for (const deadline = Date.now() + timeoutMs; !predicate();) {
      if (Date.now() > deadline) throw new Error('Test condition was not met in time.');
      await settle(5);
    }
  }

  test('undo and whole-task undo work with no network and count as local edits; session destroy cleans up', async () => {
    const scope: PageScope = { knowledgeBaseId: crypto.randomUUID(), pageId: crypto.randomUUID() };
    const session = connectPageDocument({
      scope,
      origin: 'http://127.0.0.1:8710',
      WebSocketPolyfill: UnreachableSocket as never,
      reconnectDelayMs: 10,
      maxReconnectDelayMs: 10,
      loadTimeoutMs: 500,
    });
    await until(() => session.getStatus().localReady);
    await until(() => session.getStatus().phase === 'offline');

    const pageUndo = createPageUndo({ document: session.document, clientId: 'window_a' });
    const content = session.document.getXmlFragment('content');
    const updateOrigins: unknown[] = [];
    session.document.on('update', (_update, origin) => updateOrigins.push(origin));

    addParagraph(session.document, content, 'draft', 'human draft', pageUndo.origin);
    const task = pageUndo.task(agentOrigin('task_note'));
    addParagraph(session.document, content, 'ai_note', 'AI note', task.origin);

    expect(pageUndo.undo()).toBe(true);
    expect(blockIds(content)).toEqual(['ai_note']);
    // Undo is a local transaction from the manager itself — the B04 rule
    // (`origin !== provider` → local-edit) therefore marks it cloud-pending.
    expect(updateOrigins).toHaveLength(3);
    expect(updateOrigins[2]).toBe(pageUndo.local);
    expect(session.getStatus().cloudPending).toBe(true);

    expect(task.undo()).toBe(true);
    expect(blockIds(content)).toEqual([]);
    // The session keeps editing and undoing offline afterwards.
    addParagraph(session.document, content, 're', 're-draft', pageUndo.origin);
    expect(pageUndo.canUndo()).toBe(true);

    await session.destroy();
    expect(pageUndo.local.undoStack).toHaveLength(0);
    expect(task.canUndo()).toBe(false);
  });
});
