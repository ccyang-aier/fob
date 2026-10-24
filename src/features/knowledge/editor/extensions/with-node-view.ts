/**
 * Attach a NodeView to one of the shared registry node extensions (E05/L02).
 *
 * The shared schema (E01) owns the node definitions; browser presentation is
 * layered on top by replacing the registry's extension for that node with a
 * copy that renders a NodeView. The schema itself is untouched — every
 * consumer (backend indexers, Markdown pipeline, other clients) keeps reading
 * the identical node specs.
 */

import type { Extensions } from '@tiptap/core';

interface ExtendableExtension {
  name: string;
  extend: (config: { addNodeView: () => unknown }) => unknown;
}

/**
 * Returns a copy of the extension list where the extension registered under
 * `name` (extension names are unique in Tiptap) additionally renders
 * `addNodeView`. The input list is never mutated; a missing name is a no-op so
 * callers can layer presentation over any registry revision.
 */
export function withNodeView(extensions: Extensions, name: string, addNodeView: () => unknown): Extensions {
  let replaced = false;
  const next = extensions.map((extension) => {
    const candidate = extension as unknown as ExtendableExtension;
    if (candidate.name !== name || typeof candidate.extend !== 'function') return extension;
    replaced = true;
    return candidate.extend({ addNodeView }) as typeof extension;
  });
  return replaced ? (next as Extensions) : extensions;
}
