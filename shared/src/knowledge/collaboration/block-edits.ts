import type * as Y from 'yjs';

/** Display provenance travels with the document; it is separate from body semantics. */
export const BLOCK_EDITS_MAP = 'fob:block-edits';
export type BlockEdit = { actorId: string; actorName: string | null; editedAt: string; fingerprint: string };
export type BlockEdits = Record<string, BlockEdit>;

export function readBlockEdit(value: unknown): BlockEdit | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<BlockEdit>;
  return typeof entry.actorId === 'string' && (entry.actorName === null || typeof entry.actorName === 'string')
    && typeof entry.editedAt === 'string' && Number.isFinite(Date.parse(entry.editedAt))
    && typeof entry.fingerprint === 'string' && /^[0-9a-f]{16}$/.test(entry.fingerprint) ? entry as BlockEdit : null;
}

/** A display freshness key, not a security signature or an audit credential. */
export function blockEditFingerprint(content: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let index = 0; index < content.length; index++) {
    const char = content.charCodeAt(index);
    a = Math.imul(a ^ char, 0x01000193); b = Math.imul(b ^ char, 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function snapshotDocumentBlocks(document: Y.Doc): Map<string, string> {
  const snapshot = new Map<string, string>();
  function visit(element: Y.XmlElement | Y.XmlText | Y.XmlHook) {
    if (!('nodeName' in element)) return;
    const id = element.getAttribute('blockId');
    if (typeof id === 'string') snapshot.set(id, element.toString());
    element.toArray().forEach(visit);
  }
  document.getXmlFragment('default').toArray().forEach(visit);
  return snapshot;
}

/** Read only the requested block's content when a menu is open. */
export function documentBlockContent(document: Y.Doc, blockId: string): string | null {
  function find(children: (Y.XmlElement | Y.XmlText | Y.XmlHook)[]): string | null {
    for (const child of children) {
      if (!('nodeName' in child)) continue;
      if (child.getAttribute('blockId') === blockId) return child.toString();
      const nested = find(child.toArray());
      if (nested !== null) return nested;
    }
    return null;
  }
  return find(document.getXmlFragment('default').toArray());
}

export function blockContentSnapshot(body: unknown): Map<string, string> {
  const snapshot = new Map<string, string>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const node = value as { attrs?: { blockId?: unknown }; content?: unknown[] };
    if (typeof node.attrs?.blockId === 'string') snapshot.set(node.attrs.blockId, JSON.stringify(value));
    node.content?.forEach(visit);
  }
  visit(body);
  return snapshot;
}

/** Local JSON-backed documents save body and provenance in the same store update. */
export function updateBlockEdits(before: unknown, after: unknown, previous: BlockEdits, edit: Omit<BlockEdit, 'fingerprint'>): BlockEdits {
  const old = blockContentSnapshot(before), current = blockContentSnapshot(after), next: BlockEdits = {};
  for (const [id, value] of current) {
    if (old.get(id) !== value) next[id] = { ...edit, fingerprint: blockEditFingerprint(value) };
    else if (previous[id]) next[id] = previous[id];
  }
  return next;
}
