import * as Y from 'yjs';
import type { Extension } from '@hocuspocus/server';
import { BLOCK_EDITS_MAP, blockEditFingerprint, snapshotDocumentBlocks, type BlockEdit } from '@fob/shared/knowledge/collaboration';
import type { PageCollaborationContext } from './page-collaboration';

const provenanceOrigin = Symbol('fob-block-edit-provenance');

/** Attribute body changes to the authenticated connection, never to a document creator. */
export function blockEditsExtension(): Extension<PageCollaborationContext> {
  const snapshots = new WeakMap<Y.Doc, Map<string, string>>();
  return {
    extensionName: 'fob-block-edits',
    async afterLoadDocument({ document }) { snapshots.set(document, snapshotDocumentBlocks(document)); },
    async onChange({ document, context, transactionOrigin }) {
      if (transactionOrigin === provenanceOrigin) return;
      const current = snapshotDocumentBlocks(document), previous = snapshots.get(document);
      snapshots.set(document, current);
      // Loads and trusted internal/relay updates have no human attribution.
      if (!previous || !context?.profile || !['edit', 'full'].includes(context.level)) return;
      const changed = [...current].filter(([id, value]) => previous.get(id) !== value).map(([id]) => id);
      const removed = [...previous.keys()].filter(id => !current.has(id));
      if (!changed.length && !removed.length) return;
      const edit = { actorId: context.profile.id, actorName: context.profile.name, editedAt: new Date().toISOString() };
      const edits = document.getMap<BlockEdit>(BLOCK_EDITS_MAP);
      document.transact(() => {
        for (const id of changed) edits.set(id, { ...edit, fingerprint: blockEditFingerprint(current.get(id)!) });
        for (const id of removed) edits.delete(id);
      }, provenanceOrigin);
    },
  };
}
