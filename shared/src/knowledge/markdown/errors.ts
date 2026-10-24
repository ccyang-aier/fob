import type { MarkdownNode } from './types';

export type MarkdownErrorCode =
  | 'unsupported_node' | 'unsupported_mark' | 'unknown_directive'
  | 'ambiguous_mapping' | 'invalid_attribute' | 'invalid_content'
  | 'invalid_metadata' | 'unresolved_reference' | 'lossy_serialization'
  | 'invalid_anchor' | 'invalid_derived' | 'untrusted_context' | 'context_mismatch' | 'invalid_range';

/** Importers can surface a precise failure instead of accepting a lossy document. */
export class KnowledgeMarkdownError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(readonly code: MarkdownErrorCode, message: string, node?: MarkdownNode, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KnowledgeMarkdownError';
    this.line = node?.position?.start.line;
    this.column = node?.position?.start.column;
  }
}

export function unsupported(node: MarkdownNode): never {
  throw new KnowledgeMarkdownError('unsupported_node', `Unsupported Markdown node: ${node.type}`, node);
}
