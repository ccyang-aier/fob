/**
 * Unit tests of the pure presence layer (B07) — no DOM, no editor instance.
 *
 * The y-sync plugin state is provided by a real `ySyncPluginKey`-keyed plugin
 * over an `initProseMirrorDoc` mapping (the same binding data the live editor
 * exposes), and the fake network is the standard y-protocols test topology:
 * every awareness instance exchanges its updates with the group, so a
 * receiver sees exactly what a peer's provider would deliver.
 */

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { absolutePositionToRelativePosition, initProseMirrorDoc, ySyncPluginKey } from 'y-prosemirror';
import { EditorState, Plugin } from '@tiptap/pm/state';
import type { EditorState as EditorStateType } from '@tiptap/pm/state';
import { awarenessStateSchema } from '@fob/shared/knowledge/contracts';
import type { AwarenessState } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import {
  AWARENESS_PALETTE,
  awarenessColorFor,
  buildLocalAwarenessState,
  buildRemoteCursorDecorations,
  readAwarenessMembers,
} from './awareness';
import type { AwarenessCursorPayload, RemoteCursorWidgetBuilder, RemoteSelectionAttrsBuilder } from './awareness';

interface BoundState {
  ydoc: Y.Doc;
  fragment: Y.XmlFragment;
  mapping: ReturnType<typeof initProseMirrorDoc>['mapping'];
  state: EditorStateType;
}

/** The y-sync plugin state shape the live binding exposes, faked headlessly. */
type FakeYSyncState = {
  doc: Y.Doc;
  type: Y.XmlFragment;
  binding: { mapping: BoundState['mapping'] };
  snapshot: null;
  prevSnapshot: null;
};

/** A headless editor state whose y-sync plugin state carries a real mapping. */
function buildBoundState(blocks: Array<{ text: string; blockId: string }>): BoundState {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment('default');
  ydoc.transact(() => {
    for (const block of blocks) {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.setAttribute('blockId', block.blockId);
      const text = new Y.XmlText();
      text.insert(0, block.text);
      paragraph.insert(0, [text]);
      fragment.insert(fragment.length, [paragraph]);
    }
  });
  const { doc, mapping } = initProseMirrorDoc(fragment, knowledgeSchema);
  const fakeYSync = (): FakeYSyncState => ({ doc: ydoc, type: fragment, binding: { mapping }, snapshot: null, prevSnapshot: null });
  const state = EditorState.create({
    schema: knowledgeSchema,
    doc,
    plugins: [new Plugin<FakeYSyncState>({
      key: ySyncPluginKey,
      state: { init: () => fakeYSync(), apply: (_tr, value) => value },
    })],
  });
  return { ydoc, fragment, mapping, state };
}

/** Relative-position JSON exactly as the publisher serializes a caret end. */
function relativeJson(pos: number, bound: BoundState): AwarenessState['cursor'] {
  return Y.relativePositionToJSON(absolutePositionToRelativePosition(pos, bound.fragment, bound.mapping)) as AwarenessState['cursor'];
}

/** The provider-style exchange topology: every member applies every update. */
function connectedAwareness(count: number): Awareness[] {
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

function humanState(userId: string, name: string, cursor: AwarenessCursorPayload, isEditing: boolean): AwarenessState {
  return {
    user: { id: userId, name },
    color: awarenessColorFor(userId),
    kind: 'human',
    cursor,
    selection: null,
    isEditing,
  };
}

function agentState(userId: string, taskId: string, cursor: AwarenessCursorPayload): AwarenessState {
  return {
    user: { id: userId, name: '研究智能体' },
    color: '#0f766e',
    kind: 'agent',
    cursor,
    selection: null,
    isEditing: true,
    taskId,
  };
}

// Headless decoration builders: the factories must never be invoked without a view.
const headlessCursorWidget: RemoteCursorWidgetBuilder = () => () => {
  throw new Error('widget DOM is not exercised in the headless test');
};
const headlessSelectionAttrs: RemoteSelectionAttrsBuilder = () => ({ class: 'fob-awareness-selection' });

describe('awareness palette', () => {
  test('the palette is eight distinct valid hex colors and assignment is stable', () => {
    expect(AWARENESS_PALETTE).toHaveLength(8);
    expect(new Set(AWARENESS_PALETTE).size).toBe(8);
    for (const color of AWARENESS_PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    const ids = ['user-1', 'alice', '00000000-0000-4000-8000-000000000009', 'agent-task-42'];
    for (const id of ids) {
      const color = awarenessColorFor(id);
      expect((AWARENESS_PALETTE as readonly string[]).includes(color)).toBe(true);
      expect(awarenessColorFor(id)).toBe(color);
    }
    // The palette spreads across ids instead of bucketing them together.
    expect(new Set(ids.map((id) => awarenessColorFor(id))).size).toBeGreaterThan(1);
  });
});

describe('buildLocalAwarenessState against the shared contract', () => {
  test('human forms parse, with and without an image', () => {
    const userId = crypto.randomUUID();
    const withImage = buildLocalAwarenessState(
      { userId, name: '张三', image: null },
      { anchor: { item: { client: 1, clock: 0 }, assoc: 0 }, head: { item: { client: 1, clock: 0 }, assoc: 0 } },
      null,
      false,
    );
    expect(() => awarenessStateSchema.parse(withImage)).not.toThrow();
    expect(withImage).toMatchObject({ kind: 'human', color: awarenessColorFor(userId), isEditing: false });
    expect(withImage.user.image).toBe(null);

    const withoutImage = buildLocalAwarenessState({ userId: crypto.randomUUID(), name: 'Li' }, null, null, true);
    expect(() => awarenessStateSchema.parse(withoutImage)).not.toThrow();
    expect('image' in withoutImage.user).toBe(false);
  });

  test('the backend agent form (blockId cursor, taskId) parses too', () => {
    const state = {
      user: { id: crypto.randomUUID(), name: 'Summarizer' },
      color: '#7c3aed',
      kind: 'agent',
      cursor: { anchor: 'blk-1', head: 'blk-2' },
      selection: null,
      isEditing: true,
      taskId: crypto.randomUUID(),
    } satisfies AwarenessState;
    expect(() => awarenessStateSchema.parse(state)).not.toThrow();
  });
});

describe('readAwarenessMembers', () => {
  test('the same account in another window is not a second member', () => {
    const [tabA, tabB] = connectedAwareness(2);
    const identity = { userId: crypto.randomUUID(), name: 'Admin' };
    tabA.setLocalState(buildLocalAwarenessState(identity, null, null, false));
    tabB.setLocalState(buildLocalAwarenessState(identity, null, null, true));
    expect(readAwarenessMembers(tabA, tabA.clientID)).toEqual([]);
    expect(readAwarenessMembers(tabB, tabB.clientID)).toEqual([]);
    tabA.destroy();
    tabB.destroy();
  });

  test('remote accounts merge tabs and retain presence until their last connection leaves', () => {
    const [tabA, tabB, receiver] = connectedAwareness(3);
    const identity = { userId: crypto.randomUUID(), name: 'Alice' };
    tabA.setLocalState(buildLocalAwarenessState(identity, null, null, false));
    tabB.setLocalState(buildLocalAwarenessState(identity, null, null, true));
    expect(readAwarenessMembers(receiver, receiver.clientID)).toHaveLength(1);
    expect(readAwarenessMembers(receiver, receiver.clientID)[0]?.isEditing).toBe(true);
    tabB.setLocalState(null);
    expect(readAwarenessMembers(receiver, receiver.clientID)).toHaveLength(1);
    expect(readAwarenessMembers(receiver, receiver.clientID)[0]?.isEditing).toBe(false);
    tabA.setLocalState(null);
    expect(readAwarenessMembers(receiver, receiver.clientID)).toEqual([]);
    for (const awareness of [tabA, tabB, receiver]) awareness.destroy();
  });

  test('agent tasks are distinct from their human owner and from each other', () => {
    const [agentA, agentB, receiver] = connectedAwareness(3);
    const userId = crypto.randomUUID();
    receiver.setLocalState(buildLocalAwarenessState({ userId, name: 'Admin' }, null, null, false));
    agentA.setLocalState(agentState(userId, crypto.randomUUID(), { anchor: 'a', head: 'a' }));
    agentB.setLocalState(agentState(userId, crypto.randomUUID(), { anchor: 'b', head: 'b' }));
    expect(readAwarenessMembers(receiver, receiver.clientID).map((member) => member.kind)).toEqual(['agent', 'agent']);
    for (const awareness of [agentA, agentB, receiver]) awareness.destroy();
  });

  test('includes remote humans and agents, excludes own client, null and malformed states', () => {
    const [humanA, agentB, receiver] = connectedAwareness(3);
    const humanId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    humanA.setLocalState(humanState(humanId, '张三', { anchor: 'a', head: 'b' }, true));
    agentB.setLocalState(agentState(crypto.randomUUID(), taskId, { anchor: 'blk-2', head: 'blk-2' }));

    const members = readAwarenessMembers(receiver, receiver.clientID);
    expect(members.map((member) => member.kind)).toEqual(['human', 'agent']);
    expect(members[0]).toMatchObject({ user: { id: humanId, name: '张三' }, color: awarenessColorFor(humanId), isEditing: true });
    expect(members[1]).toMatchObject({ kind: 'agent', color: '#0f766e', taskId });

    // A transient null entry (peer going offline) is skipped, not rendered.
    (receiver.states as Map<number, unknown>).set(999_999, null);
    expect(readAwarenessMembers(receiver, receiver.clientID)).toHaveLength(2);

    // Own state never appears in own bar.
    const own = readAwarenessMembers(humanA, humanA.clientID);
    expect(own.map((member) => member.clientId)).not.toContain(humanA.clientID);

    removeAwarenessStates(agentB, [agentB.clientID], 'test');
    expect(readAwarenessMembers(receiver, receiver.clientID).map((member) => member.kind)).toEqual(['human']);

    humanA.destroy();
    agentB.destroy();
    receiver.destroy();
  });
});

describe('buildRemoteCursorDecorations', () => {
  // Two paragraphs: 'hello world' (block blk-1, pos 0..13) and 'second block'
  // (block blk-2, pos 13..27).
  function fixture() {
    return buildBoundState([
      { text: 'hello world', blockId: 'blk-1' },
      { text: 'second block', blockId: 'blk-2' },
    ]);
  }

  test('own-account cursors and selections are hidden, but agent tasks still render', () => {
    const bound = fixture();
    const [ownTab, agent, receiver] = connectedAwareness(3);
    const userId = crypto.randomUUID();
    receiver.setLocalState(buildLocalAwarenessState({ userId, name: 'Admin' }, null, null, false));
    ownTab.setLocalState(humanState(userId, 'Admin', { anchor: relativeJson(3, bound), head: relativeJson(7, bound) }, true));
    agent.setLocalState(agentState(userId, crypto.randomUUID(), { anchor: 'blk-2', head: 'blk-2' }));
    const result = buildRemoteCursorDecorations(bound.state, receiver, { cursorWidget: headlessCursorWidget, selectionAttributes: headlessSelectionAttrs });
    expect(result.resolved.map((cursor) => cursor.kind)).toEqual(['agent']);
    expect(result.decorations.find()).toHaveLength(1);
    for (const awareness of [ownTab, agent, receiver]) awareness.destroy();
    bound.ydoc.destroy();
  });

  test('relative-position and blockId cursors both resolve; garbage is skipped', () => {
    const bound = fixture();
    const [humanA, agentB, garbageC, receiver] = connectedAwareness(4);
    const humanId = crypto.randomUUID();
    humanA.setLocalState(humanState(humanId, 'Alice', { anchor: relativeJson(3, bound), head: relativeJson(7, bound) }, false));
    agentB.setLocalState(agentState(crypto.randomUUID(), crypto.randomUUID(), { anchor: 'blk-2', head: 'blk-2' }));
    garbageC.setLocalState(humanState(crypto.randomUUID(), 'Broken', { anchor: 42, head: true }, false));

    const result = buildRemoteCursorDecorations(bound.state, receiver, { cursorWidget: headlessCursorWidget, selectionAttributes: headlessSelectionAttrs });
    const human = result.resolved.find((entry) => entry.kind === 'human');
    const agent = result.resolved.find((entry) => entry.kind === 'agent');
    expect(result.resolved).toHaveLength(2);
    expect(human).toMatchObject({ name: 'Alice', anchor: 3, head: 7, isEditing: false });
    expect(agent).toMatchObject({ anchor: 13, head: 13, isEditing: true });

    const found = result.decorations.find(undefined, undefined, (spec) => spec.fobAwareness !== undefined);
    expect(found).toHaveLength(3); // human caret + human selection + agent caret
    const widgets = found.filter((decoration) => decoration.from === decoration.to);
    expect(widgets.map((widget) => widget.from).sort((a, b) => a - b)).toEqual([7, 13]);
    const selection = found.find((decoration) => decoration.from !== decoration.to);
    expect(selection).toMatchObject({ from: 3, to: 7 });

    for (const awareness of [humanA, agentB, garbageC, receiver]) awareness.destroy();
    bound.ydoc.destroy();
  });

  test('a blockId cursor for a deleted/unknown block and malformed JSON cursors render nothing', () => {
    const bound = fixture();
    const [ghost, receiver] = connectedAwareness(2);
    ghost.setLocalState(humanState(crypto.randomUUID(), 'Ghost', { anchor: 'no-such-block', head: 'no-such-block' }, true));
    expect(buildRemoteCursorDecorations(bound.state, receiver, { cursorWidget: headlessCursorWidget, selectionAttributes: headlessSelectionAttrs }).resolved).toEqual([]);

    ghost.setLocalState(humanState(crypto.randomUUID(), 'Broken', { anchor: { item: null }, head: [1, 2, 3] }, true));
    expect(buildRemoteCursorDecorations(bound.state, receiver, { cursorWidget: headlessCursorWidget, selectionAttributes: headlessSelectionAttrs }).resolved).toEqual([]);

    ghost.destroy();
    receiver.destroy();
    bound.ydoc.destroy();
  });

  test('a removed remote state produces no decoration', () => {
    const bound = fixture();
    const [humanA, receiver] = connectedAwareness(2);
    humanA.setLocalState(humanState(crypto.randomUUID(), 'Alice', { anchor: relativeJson(3, bound), head: relativeJson(7, bound) }, true));
    const before = buildRemoteCursorDecorations(bound.state, receiver, { cursorWidget: headlessCursorWidget, selectionAttributes: headlessSelectionAttrs });
    expect(before.resolved).toHaveLength(1);

    removeAwarenessStates(humanA, [humanA.clientID], 'test');
    const after = buildRemoteCursorDecorations(bound.state, receiver, { cursorWidget: headlessCursorWidget, selectionAttributes: headlessSelectionAttrs });
    expect(after.resolved).toEqual([]);
    expect(after.decorations.find(undefined, undefined, (spec) => spec.fobAwareness !== undefined)).toEqual([]);

    humanA.destroy();
    receiver.destroy();
    bound.ydoc.destroy();
  });
});
