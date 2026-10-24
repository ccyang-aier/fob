import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { nodeAnnotationsSchema, suggestionMarkNames, suggestionMetadataSchema } from '../annotations';
import type { NodeAnnotation, SuggestionMarkName, SuggestionMetadata } from '../annotations';

export interface SuggestionRange {
  from: number;
  to: number;
  type: SuggestionMarkName;
  storage: 'mark' | 'node';
}
export interface SuggestionSummary extends SuggestionMetadata { ranges: SuggestionRange[] }

export function nodeAnnotations(node: ProseMirrorNode): NodeAnnotation[] {
  return node.attrs.annotations === undefined || node.attrs.annotations === null ? [] : nodeAnnotationsSchema.parse(node.attrs.annotations);
}

export function isSuggestionMark(name: string): name is SuggestionMarkName {
  return suggestionMarkNames.some((candidate) => candidate === name);
}

export function collectSuggestions(doc: ProseMirrorNode): SuggestionSummary[] {
  const found = new Map<string, SuggestionSummary>();
  function add(metadata: SuggestionMetadata, range: SuggestionRange) {
    const previous = found.get(metadata.suggestionId);
    if (previous && (previous.author !== metadata.author || previous.createdAt !== metadata.createdAt)) {
      throw new Error('One suggestion ID has conflicting authorship metadata');
    }
    const summary = previous ?? { ...metadata, ranges: [] };
    summary.ranges.push(range);
    found.set(metadata.suggestionId, summary);
  }
  doc.descendants((node, position) => {
    for (const annotation of nodeAnnotations(node)) {
      add(annotation.attrs, { from: position, to: position + node.nodeSize, type: annotation.type, storage: 'node' });
    }
    for (const mark of node.marks) {
      if (isSuggestionMark(mark.type.name)) add(suggestionMetadataSchema.parse(mark.attrs), {
        from: position, to: position + node.nodeSize, type: mark.type.name, storage: 'mark',
      });
    }
  });
  return [...found.values()];
}
