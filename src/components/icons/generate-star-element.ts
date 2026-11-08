'use client';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenerateStar } from './index';

const templates = new WeakMap<Document, SVGElement>();

/** A detached copy of the official renderer output for imperative cursor widgets. */
export function createGenerateStarElement(ownerDocument: Document, className: string): SVGElement {
  let template = templates.get(ownerDocument);
  if (!template) {
    const container = ownerDocument.createElement('template');
    // All markup comes from the same catalog component as the React surfaces;
    // neither user data nor a second copy of the glyph's path enters this DOM.
    container.innerHTML = renderToStaticMarkup(createElement(GenerateStar, { size: '9px', 'aria-hidden': true }));
    template = container.content.firstElementChild as SVGElement;
    templates.set(ownerDocument, template);
  }
  const icon = template.cloneNode(true) as SVGElement;
  icon.classList.add(className);
  return icon;
}
