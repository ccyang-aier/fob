import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { BLOCK_EDITS_MAP, readBlockEdit, snapshotDocumentBlocks, blockEditFingerprint } from '@fob/shared/knowledge/collaboration';
import { blockEditsExtension } from './block-edits';
import type { PageCollaborationContext } from './page-collaboration';

const context = { level: 'edit', profile: { id: 'member-a', name: '真实编辑者', image: null } } as PageCollaborationContext;
function fixture() {
  const document = new Y.Doc(), paragraph = new Y.XmlElement('paragraph'), text = new Y.XmlText('正文');
  document.getXmlFragment('default').insert(0, [paragraph]);
  paragraph.setAttribute('blockId', 'body'); paragraph.insert(0, [text]);
  return { document, paragraph, text, extension: blockEditsExtension() };
}
type Tracker = ReturnType<typeof blockEditsExtension>;
const loaded = (extension: Tracker, document: Y.Doc) => extension.afterLoadDocument!({ document } as Parameters<NonNullable<Tracker['afterLoadDocument']>>[0]);
const changed = (extension: Tracker, document: Y.Doc, actor = context) => extension.onChange!({ document, context: actor } as Parameters<NonNullable<Tracker['onChange']>>[0]);

test('authenticated block edits propagate with the Yjs document and survive persisted reloads', async () => {
  const { document, text, extension } = fixture();
  await loaded(extension, document);
  expect(document.getMap(BLOCK_EDITS_MAP).size).toBe(0);
  text.insert(text.length, '更新'); await changed(extension, document);
  const edit = readBlockEdit(document.getMap(BLOCK_EDITS_MAP).get('body'))!;
  expect(edit.actorId).toBe('member-a'); expect(edit.actorName).toBe('真实编辑者');
  expect(Date.now() - Date.parse(edit.editedAt)).toBeLessThan(2000);
  const replica = new Y.Doc(); Y.applyUpdate(replica, Y.encodeStateAsUpdate(document));
  expect(replica.getMap(BLOCK_EDITS_MAP).get('body')).toEqual(edit);
  expect(edit.fingerprint).toBe(blockEditFingerprint(snapshotDocumentBlocks(replica).get('body')!));
  expect(snapshotDocumentBlocks(replica)).toEqual(snapshotDocumentBlocks(document));
  await changed(extension, document);
  expect(document.getMap(BLOCK_EDITS_MAP).get('body')).toEqual(edit);
  document.getXmlFragment('default').delete(0); await changed(extension, document);
  expect(document.getMap(BLOCK_EDITS_MAP).has('body')).toBe(false);
  document.destroy(); replica.destroy();
});

test('loads, read-only connections and unattributed internal changes do not invent authors', async () => {
  const { document, text, extension } = fixture();
  await loaded(extension, document);
  text.insert(0, 'load'); await changed(extension, document, { ...context, profile: undefined });
  expect(document.getMap(BLOCK_EDITS_MAP).size).toBe(0);
  text.insert(0, 'readonly'); await changed(extension, document, { ...context, level: 'view' });
  expect(document.getMap(BLOCK_EDITS_MAP).size).toBe(0);
  text.insert(0, 'human'); await changed(extension, document);
  expect(readBlockEdit(document.getMap(BLOCK_EDITS_MAP).get('body'))?.actorId).toBe('member-a');
  text.insert(0, 'unattributed'); await changed(extension, document, { ...context, profile: undefined });
  expect(readBlockEdit(document.getMap(BLOCK_EDITS_MAP).get('body'))?.fingerprint).not.toBe(blockEditFingerprint(snapshotDocumentBlocks(document).get('body')!));
  document.destroy();
});
