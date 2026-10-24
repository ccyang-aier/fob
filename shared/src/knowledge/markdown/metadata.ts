import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { assertKnownAttributes, sameValue } from './attributes';
import { childNodes } from './block-codecs';
import { decodeMarks, META_DIRECTIVE } from './directives';
import { KnowledgeMarkdownError } from './errors';
import type { MarkdownContext, MarkdownNode } from './types';

interface NodeMetadata {
  path: number[];
  type: string;
  attrs?: Record<string, unknown>;
  marks?: unknown[];
}

/** Only attributes/marks are supplemental; text and structure remain real Markdown. */
export function metadataDifferences(expected: ProseMirrorNode, actual: ProseMirrorNode): NodeMetadata[] | null {
  const entries: NodeMetadata[] = [];
  function visit(left: ProseMirrorNode, right: ProseMirrorNode, path: number[]): boolean {
    if (left.type.name !== right.type.name || left.text !== right.text || left.childCount !== right.childCount) return false;
    const attrs = Object.fromEntries(Object.entries(left.attrs).filter(([key, value]) => !sameValue(value, right.attrs[key])));
    const marks = left.marks.map((mark) => mark.toJSON());
    const differentMarks = !sameValue(marks, right.marks.map((mark) => mark.toJSON()));
    if (Object.keys(attrs).length || differentMarks) entries.push({ path, type: left.type.name, ...(Object.keys(attrs).length ? { attrs } : {}), ...(differentMarks ? { marks } : {}) });
    for (let index = 0; index < left.childCount; index++) if (!visit(left.child(index), right.child(index), [...path, index])) return false;
    return true;
  }
  return visit(expected, actual, []) ? entries : null;
}

export function metadataNode(entries: NodeMetadata[]): MarkdownNode {
  return { type: 'leafDirective', name: META_DIRECTIVE, attributes: { data: JSON.stringify(entries) }, children: [] };
}

export function applyMetadata(node: ProseMirrorNode, source: MarkdownNode, context: MarkdownContext): ProseMirrorNode {
  const fail = (message: string): never => { throw new KnowledgeMarkdownError('invalid_metadata', message, source); };
  if (Object.keys(source.attributes ?? {}).some((key) => key !== 'data') || source.children?.length) fail('Unexpected metadata fields');
  let value: unknown;
  try { value = JSON.parse(source.attributes?.data ?? ''); } catch { fail('Malformed metadata JSON'); }
  if (!Array.isArray(value)) return fail('Metadata must be an array');
  const patches = new Map<string, NodeMetadata>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Invalid metadata entry');
    const entry = raw as NodeMetadata;
    if (Object.keys(entry).some((key) => !['path', 'type', 'attrs', 'marks'].includes(key))
      || !Array.isArray(entry.path) || entry.path.some((part) => !Number.isSafeInteger(part) || part < 0)
      || typeof entry.type !== 'string' || (entry.attrs !== undefined && (!entry.attrs || typeof entry.attrs !== 'object' || Array.isArray(entry.attrs)))
      || (entry.marks !== undefined && !Array.isArray(entry.marks))) fail('Invalid metadata entry fields');
    const key = entry.path.join('/');
    if (patches.has(key)) fail('Duplicate metadata path');
    patches.set(key, entry);
  }
  function visit(current: ProseMirrorNode, path: number[]): ProseMirrorNode {
    const key = path.join('/');
    const patch = patches.get(key);
    patches.delete(key);
    if (patch && patch.type !== current.type.name) fail(`Metadata expected ${patch.type}, found ${current.type.name}`);
    if (patch?.attrs) assertKnownAttributes(current.type, patch.attrs, source);
    const marks = patch?.marks ? decodeMarks(patch.marks, context, source) : current.marks;
    try {
      if (current.isText) return current.mark(marks);
      const children = childNodes(current).map((child, index) => visit(child, [...path, index]));
      return current.type.createChecked({ ...current.attrs, ...patch?.attrs }, children, marks);
    } catch (cause) {
      if (cause instanceof KnowledgeMarkdownError) throw cause;
      throw new KnowledgeMarkdownError('invalid_metadata', `Invalid metadata for ${current.type.name}`, source, { cause });
    }
  }
  const result = visit(node, []);
  if (patches.size) fail('Metadata path does not exist in the following block');
  return result;
}
