import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { knowledgeSchema as schema, inspectBlockIds } from '../schema';
import { humanOrigin, agentOrigin, mcpOrigin, restoreOrigin, parseKnowledgeOrigin, createLocalUndoManager, createTaskUndoManager } from './index';

function sync(a: Y.Doc, b: Y.Doc) {
  const stateA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const stateB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(a, stateB, 'network');
  Y.applyUpdate(b, stateA, 'network');
}
function addText(doc: Y.Doc, text: Y.Text, origin: string | object | null, value: string) {
  doc.transact(() => text.insert(text.length, value), origin);
}
function paragraph(id: string, value: string) {
  return schema.nodes.paragraph.create({ blockId: id }, value ? schema.text(value) : undefined);
}

describe('transaction origin contracts', () => {
  it('separates client sessions, tasks, MCP clients and restore operations', () => {
    assert.notEqual(humanOrigin(), humanOrigin());
    assert.deepEqual(parseKnowledgeOrigin(humanOrigin('window_a')), { kind: 'human', clientId: 'window_a' });
    assert.deepEqual(parseKnowledgeOrigin(agentOrigin('task_a')), { kind: 'agent', taskId: 'task_a' });
    assert.deepEqual(parseKnowledgeOrigin(mcpOrigin('研究: Agent', 'task_b')), { kind: 'mcp', clientName: '研究: Agent', taskId: 'task_b' });
    assert.deepEqual(parseKnowledgeOrigin(restoreOrigin('checkpoint')), { kind: 'restore', checkpointId: 'checkpoint' });
    for (const invalid of [null, {}, 'agent:', 'agent:a:b', 'mcp:%invalid:task', 'mcp:agent', 'human:bad id', 'unknown:x']) {
      assert.equal(parseKnowledgeOrigin(invalid), null);
    }
    assert.throws(() => humanOrigin('contains:colon'));
    assert.throws(() => mcpOrigin('bad\nname', 'task'));
  });
});

describe('local and task undo isolation', () => {
  it('only undoes the local human, not Agent, MCP, restore, null or another window', () => {
    const doc = new Y.Doc(); const text = doc.getText('content'); const origin = humanOrigin('a');
    const undo = createLocalUndoManager(text, { origin });
    addText(doc, text, null, 'base/');
    addText(doc, text, origin, 'mine/');
    addText(doc, text, humanOrigin('b'), 'other/');
    addText(doc, text, agentOrigin('task'), 'agent/');
    addText(doc, text, mcpOrigin('tool', 'task'), 'mcp/');
    addText(doc, text, restoreOrigin('version'), 'restore/');
    assert.ok(undo.undo());
    assert.equal(text.toString(), 'base/other/agent/mcp/restore/');
    assert.equal(undo.undo(), null);
    assert.ok(undo.redo());
    assert.equal(text.toString(), 'base/mine/other/agent/mcp/restore/');
    doc.destroy();
  });

  it('does not capture remote updates even if a provider passes the same origin label', () => {
    const local = new Y.Doc(); const remote = new Y.Doc(); const origin = humanOrigin('local');
    const undo = createLocalUndoManager(local.getText('content'), { origin });
    addText(remote, remote.getText('content'), origin, 'remote');
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote), origin);
    assert.equal(undo.canUndo(), false);
    assert.equal(local.getText('content').toString(), 'remote');
    local.destroy(); remote.destroy();
  });

  it('supports editor binding origins, explicit history suppression and capture boundaries', () => {
    const doc = new Y.Doc(); const text = doc.getText('content'); const binding = {};
    const undo = createLocalUndoManager(text, { origin: humanOrigin('a'), bindingOrigins: [binding] });
    addText(doc, text, binding, 'one/'); undo.stopCapturing();
    addText(doc, text, binding, 'two/');
    doc.transact((transaction) => { transaction.meta.set('addToHistory', false); text.insert(text.length, 'repair/'); }, binding);
    assert.equal(undo.undoStack.length, 2);
    undo.undo(); assert.equal(text.toString(), 'one/repair/');
    undo.undo(); assert.equal(text.toString(), 'repair/');
    doc.destroy();
  });

  it('undoes all streamed pieces of one task without changing other tasks or the human', () => {
    const doc = new Y.Doc(); const text = doc.getText('content'); const a = agentOrigin('a'); const b = agentOrigin('b');
    const task = createTaskUndoManager(text, a);
    addText(doc, text, a, 'A1/');
    addText(doc, text, humanOrigin('user'), 'human/');
    addText(doc, text, b, 'B/');
    // Simulate a long streaming pause without a wall-clock sleep.
    task.lastChange = 1;
    addText(doc, text, a, 'A2/');
    assert.equal(task.undoStack.length, 1);
    task.undo(); assert.equal(text.toString(), 'human/B/');
    task.redo(); assert.equal(text.toString(), 'A1/human/B/A2/');
    doc.destroy();
  });

  it('isolates concurrent calls from the same MCP client', () => {
    const doc = new Y.Doc(); const text = doc.getText('content');
    const a = mcpOrigin('Cursor', 'call_a'); const b = mcpOrigin('Cursor', 'call_b');
    const undo = createTaskUndoManager(text, a);
    addText(doc, text, a, 'first'); addText(doc, text, b, 'second');
    undo.undo(); assert.equal(text.toString(), 'second');
    doc.destroy();
  });

  it('rejects detached and cross-document scopes and invalid origin configuration', () => {
    const a = new Y.Doc(); const b = new Y.Doc();
    assert.throws(() => createLocalUndoManager(new Y.Text(), { origin: humanOrigin('a') }));
    assert.throws(() => createLocalUndoManager([a.getText('a'), b.getText('b')], { origin: humanOrigin('a') }));
    assert.throws(() => createLocalUndoManager(a, { origin: humanOrigin('a'), captureTimeout: -1 }));
    assert.throws(() => createTaskUndoManager(a, 'human:not-a-task' as ReturnType<typeof agentOrigin>));
    a.destroy(); b.destroy();
  });
});

describe('shared XML preservation and convergence', () => {
  it('keeps human edits inside an AI-created nested block, including stable block IDs', () => {
    const doc = new Y.Doc(); const content = doc.getXmlFragment('content'); const origin = agentOrigin('create');
    const task = createTaskUndoManager(content, origin);
    doc.transact(() => prosemirrorToYXmlFragment(schema.nodes.doc.create(null, schema.nodes.blockquote.create({ blockId: 'quote' }, paragraph('paragraph', 'AI text'))), content), origin);
    const replica = new Y.Doc(); sync(doc, replica);
    const quote = replica.getXmlFragment('content').get(0) as Y.XmlElement;
    const para = quote.get(0) as Y.XmlElement;
    const text = para.get(0) as Y.XmlText;
    replica.transact(() => text.insert(text.length, ' + human text'), humanOrigin('remote'));
    sync(doc, replica);
    task.undo(); sync(doc, replica);
    const actual = yXmlFragmentToProseMirrorRootNode(content, schema);
    assert.equal(actual.textContent, ' + human text');
    assert.equal(actual.firstChild?.attrs.blockId, 'quote');
    assert.equal(actual.firstChild?.firstChild?.attrs.blockId, 'paragraph');
    assert.deepEqual(inspectBlockIds(actual), []);
    assert.deepEqual(actual.toJSON(), yXmlFragmentToProseMirrorRootNode(replica.getXmlFragment('content'), schema).toJSON());
    task.redo(); sync(doc, replica);
    assert.equal(yXmlFragmentToProseMirrorRootNode(content, schema).textContent, 'AI text + human text');
    doc.destroy(); replica.destroy();
  });

  it('preserves human attribute-only changes to a new media block and its ID', () => {
    const doc = new Y.Doc(); const content = doc.getXmlFragment('content'); const origin = agentOrigin('image');
    const task = createTaskUndoManager(content, origin);
    doc.transact(() => prosemirrorToYXmlFragment(schema.nodes.doc.create(null, schema.nodes.image.create({ blockId: 'image', src: 'https://example.com/a.png' })), content), origin);
    const replica = new Y.Doc(); sync(doc, replica);
    const image = replica.getXmlFragment('content').get(0) as Y.XmlElement;
    replica.transact(() => image.setAttribute('caption', 'Human caption'), humanOrigin('remote'));
    sync(doc, replica); task.undo(); sync(doc, replica);
    const actual = yXmlFragmentToProseMirrorRootNode(content, schema).firstChild!;
    assert.equal(actual.type.name, 'image');
    assert.equal(actual.attrs.blockId, 'image');
    assert.equal(actual.attrs.caption, 'Human caption');
    assert.equal(actual.attrs.src, 'https://example.com/a.png');
    doc.destroy(); replica.destroy();
  });

  it('removes untouched AI blocks and reverts edits to attributes on pre-existing blocks', () => {
    const doc = new Y.Doc(); const content = doc.getXmlFragment('content'); const origin = agentOrigin('a');
    doc.transact(() => prosemirrorToYXmlFragment(schema.nodes.doc.create(null, paragraph('existing', 'human')), content));
    const task = createTaskUndoManager(content, origin);
    doc.transact(() => (content.get(0) as Y.XmlElement).setAttribute('sourceBlockId', 'modified'), origin);
    task.undo();
    assert.equal(yXmlFragmentToProseMirrorRootNode(content, schema).firstChild?.attrs.sourceBlockId, null);
    const fresh = new Y.Doc(); const freshContent = fresh.getXmlFragment('content'); const freshTask = createTaskUndoManager(freshContent, origin);
    fresh.transact(() => prosemirrorToYXmlFragment(schema.nodes.doc.create(null, paragraph('new', 'only AI')), freshContent), origin);
    freshTask.undo(); assert.equal(freshContent.length, 0);
    freshTask.redo(); assert.equal(yXmlFragmentToProseMirrorRootNode(freshContent, schema).textContent, 'only AI');
    doc.destroy(); fresh.destroy();
  });

  it('merges offline concurrent edits and duplicate updates and keeps local undo isolated', () => {
    const a = new Y.Doc(); const b = new Y.Doc(); const aOrigin = humanOrigin('a'); const bOrigin = humanOrigin('b');
    addText(a, a.getText('content'), null, 'base/'); sync(a, b);
    const aUndo = createLocalUndoManager(a.getText('content'), { origin: aOrigin });
    const bUndo = createLocalUndoManager(b.getText('content'), { origin: bOrigin });
    addText(a, a.getText('content'), aOrigin, 'A'); addText(b, b.getText('content'), bOrigin, 'B');
    sync(a, b); Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'duplicate');
    assert.equal(a.getText('content').toString(), b.getText('content').toString());
    aUndo.undo(); sync(a, b);
    assert.equal(a.getText('content').toString(), 'base/B');
    bUndo.undo(); sync(a, b);
    assert.equal(a.getText('content').toString(), 'base/');
    assert.deepEqual(Y.encodeStateVector(a), Y.encodeStateVector(b));
    a.destroy(); b.destroy();
  });
});
