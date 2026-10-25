import type { CSSProperties } from 'react';

/** Original Outline artwork, limited to the user's collection-page visual reference. */
export type OutlineCollectionGlyph = 'collection' | 'document' | 'team' | 'checkmark' | 'starred' | 'unstarred' | 'pin' | 'archive' | 'unpublish' | 'trash' | 'close';
export function OutlineCollectionIcon({ name, size = 24, className, style }: { name: OutlineCollectionGlyph; size?: number; className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={className} style={{ display: 'inline-block', flexShrink: 0, width: size, height: size, backgroundColor: 'currentColor', mask: `url(/icons/outline-collection/${name}.svg) center / contain no-repeat`, ...style }} />;
}
