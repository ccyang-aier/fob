import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Heart, Star } from '@/components/icons';

const templates = new Map<'heart' | 'candy', string>();

/** Decorative particles reuse the same official glyphs as the React controls. */
export function companionParticleIcon(kind: 'heart' | 'candy') {
  let markup = templates.get(kind);
  if (!markup) {
    markup = renderToStaticMarkup(createElement(kind === 'heart' ? Heart : Star, {
      size: kind === 'heart' ? 44 : 54,
      'aria-hidden': true,
    }));
    templates.set(kind, markup);
  }
  return markup;
}
