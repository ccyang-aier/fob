import { createTranslator, getLocale } from '@/lib/i18n';
import { knowledgeMessages } from './document-html-export.messages';

import type { Editor } from '@tiptap/core';

const knowledgeT = createTranslator(knowledgeMessages);

const OMIT =
  '[data-document-export-omit],button,[role="menu"],[role="dialog"],[role="toolbar"],script,style,link,object,embed,foreignObject,.ProseMirror-gapcursor,.ProseMirror-widget,.column-resize-handle';
const NON_VISUAL =
  /^(animation|transition|cursor|caret-color|user-select|pointer-events|scrollbar|scroll-|overscroll|touch-action|-webkit-user-modify|view-transition)/;

export function escapeDocumentHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

function cssStyle(style: CSSStyleDeclaration): string {
  return Array.from({ length: style.length }, (_, index) => style.item(index))
    .filter((property) => !property.startsWith('--') && !NON_VISUAL.test(property))
    .map((property) => `${property}:${style.getPropertyValue(property)};`)
    .join('');
}

function fontFamilies(value: string): string[] {
  return value.split(',').map((family) =>
    family
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase(),
  );
}

function containsGlyph(range: string, text: string): boolean {
  if (!range) return true;
  const intervals = range.split(',').map((part) => {
    const value = part.trim().replace(/^U\+/i, '');
    if (value.includes('?'))
      return [parseInt(value.replaceAll('?', '0'), 16), parseInt(value.replaceAll('?', 'F'), 16)];
    const [start, end = start] = value.split('-');
    return [parseInt(start, 16), parseInt(end, 16)];
  });
  return Array.from(text).some((char) =>
    intervals.some(([start, end]) => char.codePointAt(0)! >= start && char.codePointAt(0)! <= end),
  );
}

/** Snapshot the rendered document, including NodeViews, instead of maintaining a second theme. */
export async function exportDocumentHtml(editor: Editor, title: string): Promise<string> {
  const prose = editor.view.dom;
  const source =
    prose.closest<HTMLElement>('[data-document-export-root],[data-width][data-font][data-size]') ??
    prose;
  const owner = source.ownerDocument;
  const view = owner.defaultView!;
  await owner.fonts?.ready;
  const clone = source.cloneNode(true) as HTMLElement;
  const resources = new Map<string, Promise<string>>();
  const families = new Set<string>();
  const pseudoRules: string[] = [];
  const pending: Promise<void>[] = [];
  let sequence = 0;

  const resource = (url: string, base = owner.baseURI): Promise<string> => {
    if (url.startsWith('data:') || url.startsWith('#')) return Promise.resolve(url);
    const resolved = new URL(url, base);
    if (
      resolved.hash &&
      resolved.origin === view.location.origin &&
      resolved.pathname === view.location.pathname &&
      resolved.search === view.location.search
    )
      return Promise.resolve(resolved.hash);
    const absolute = resolved.href;
    if (!resources.has(absolute))
      resources.set(
        absolute,
        (async () => {
          const response = await fetch(absolute, { credentials: 'same-origin' });
          if (!response.ok)
            throw new Error(knowledgeT('unableToReadDocumentAssetsCheckAssetAccess'));
          const blob = await response.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new view.FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error(knowledgeT('unableToEmbedDocumentAssets')));
            reader.readAsDataURL(blob);
          });
        })(),
      );
    return resources.get(absolute)!;
  };
  const inlineUrls = async (css: string, base = owner.baseURI): Promise<string> => {
    const matches = Array.from(css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g));
    let result = css;
    for (const match of matches)
      result = result.replace(
        match[0],
        `url("${await resource((match[1] ?? match[2] ?? match[3]).trim(), base)}")`,
      );
    return result;
  };

  const snapshot = (original: Element, copy: Element) => {
    const staticControl = original.matches(
      'button[data-document-callout-icon],button[data-document-export-text]',
    );
    if (original.matches(OMIT) && !staticControl) {
      copy.remove();
      return;
    }
    if (staticControl) {
      const icon = owner.createElement('span');
      for (const attribute of Array.from(copy.attributes))
        icon.setAttribute(attribute.name, attribute.value);
      icon.append(...Array.from(copy.childNodes));
      copy.replaceWith(icon);
      copy = icon;
    }
    const computed = view.getComputedStyle(original);
    if (computed.display === 'none') {
      copy.remove();
      return;
    }
    const id = String(sequence++);
    copy.setAttribute('data-export-id', id);
    for (const family of fontFamilies(computed.fontFamily)) families.add(family);
    const visual = cssStyle(computed);
    pending.push(
      inlineUrls(visual).then((style) => {
        copy.setAttribute('style', style);
      }),
    );
    for (const pseudo of ['::before', '::after', '::marker']) {
      if (
        pseudo !== '::marker' &&
        (original.classList.contains('selectedCell') ||
          original.matches('p:has(> br.ProseMirror-trailingBreak):only-child'))
      )
        continue;
      const style = view.getComputedStyle(original, pseudo);
      if (style.content === 'none' || style.content === 'normal' || !style.content) continue;
      for (const family of fontFamilies(style.fontFamily)) families.add(family);
      pending.push(
        inlineUrls(cssStyle(style)).then((value) => {
          pseudoRules.push(`[data-export-id="${id}"]${pseudo}{${value}}`);
        }),
      );
    }
    for (const attribute of Array.from(copy.attributes)) {
      if (
        /^on/i.test(attribute.name) ||
        [
          'contenteditable',
          'draggable',
          'tabindex',
          'autofocus',
          'spellcheck',
          'data-block-id',
        ].includes(attribute.name)
      )
        copy.removeAttribute(attribute.name);
    }
    const children = Array.from(original.children);
    const copies = Array.from(copy.children);
    children.forEach((child, index) => snapshot(child, copies[index]));

    if (
      original.tagName === 'INPUT' ||
      original.tagName === 'TEXTAREA' ||
      original.tagName === 'SELECT'
    ) {
      const control = original as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (
        original.tagName === 'INPUT' &&
        ['file', 'hidden', 'checkbox'].includes((control as HTMLInputElement).type)
      ) {
        copy.remove();
        return;
      }
      const heading = original.hasAttribute('data-knowledge-title');
      const replacement = owner.createElement(heading ? 'h1' : 'span');
      replacement.setAttribute('data-export-id', id);
      replacement.textContent = heading
        ? title.trim() || knowledgeT('untitledDocument')
        : original.tagName === 'SELECT'
          ? ((original as HTMLSelectElement).selectedOptions[0]?.textContent ?? '')
          : control.value;
      if (!replacement.textContent) {
        copy.remove();
        return;
      }
      // Wait for resource expansion before moving the presentation onto the static text.
      pending.push(
        inlineUrls(visual).then((style) => {
          replacement.setAttribute(
            'style',
            `${style}white-space:pre-wrap;${heading ? 'display:block;max-width:100%;overflow-wrap:anywhere;' : ''}`,
          );
        }),
      );
      copy.replaceWith(replacement);
      return;
    }
    if (original.tagName === 'CANVAS') {
      const image = owner.createElement('img');
      image.src = (original as HTMLCanvasElement).toDataURL();
      pending.push(
        inlineUrls(visual).then((style) => {
          image.setAttribute('style', style);
        }),
      );
      copy.replaceWith(image);
      return;
    }
    if (original.tagName === 'IFRAME') {
      const link = owner.createElement('a');
      link.href = (original as HTMLIFrameElement).src;
      link.textContent = knowledgeT('valueOpenOnline', {
        v0: original.getAttribute('title') || knowledgeT('externalEmbed'),
      });
      link.style.cssText =
        'display:flex;align-items:center;justify-content:center;min-height:120px;color:inherit;text-decoration:underline';
      copy.replaceWith(link);
      return;
    }
    const attributes =
      original.tagName === 'IMG'
        ? [['src', (original as HTMLImageElement).currentSrc || original.getAttribute('src')]]
        : ['src', 'poster'].map((attribute) => [attribute, original.getAttribute(attribute)]);
    if (original.tagName === 'A' && original.hasAttribute('download'))
      attributes.push(['href', original.getAttribute('href')]);
    if (original.tagName.toLowerCase() === 'image')
      attributes.push([
        'href',
        original.getAttribute('href') ?? original.getAttribute('xlink:href'),
      ]);
    for (const [attribute, url] of attributes)
      if (url)
        pending.push(
          resource(url).then((value) => {
            copy.setAttribute(attribute!, value);
          }),
        );
    copy.removeAttribute('srcset');
    copy.removeAttribute('sizes');
    copy.removeAttribute('loading');
    for (const attribute of ['href', 'xlink:href']) {
      const value = copy.getAttribute(attribute);
      if (value && /^\s*(javascript|vbscript):/i.test(value)) copy.removeAttribute(attribute);
      else if (value && !value.startsWith('#') && !value.startsWith('data:'))
        copy.setAttribute(attribute, new URL(value, owner.baseURI).href);
    }
  };
  snapshot(source, clone);
  await Promise.all(pending);

  const fontRules: string[] = [];
  const text = clone.textContent ?? '';
  const collectFonts = async (rules: CSSRuleList, base: string): Promise<void> => {
    for (const rule of Array.from(rules)) {
      if ('style' in rule && rule.cssText.startsWith('@font-face')) {
        const style = (rule as CSSFontFaceRule).style;
        if (
          !fontFamilies(style.getPropertyValue('font-family')).some((family) =>
            families.has(family),
          ) ||
          !containsGlyph(style.getPropertyValue('unicode-range'), text)
        )
          continue;
        // Use the embedded URL even when the exporting machine has a locally installed copy.
        const src = style.getPropertyValue('src').replace(/local\([^)]*\)\s*,?\s*/g, '');
        if (!src.includes('url(')) continue;
        const descriptors = style.cssText.replace(/src\s*:[^;]*;?/, '');
        fontRules.push(
          `@font-face{${descriptors};src:${await inlineUrls(src, base)};font-display:block;}`,
        );
      } else if ('cssRules' in rule) await collectFonts((rule as CSSGroupingRule).cssRules, base);
    }
  };
  await Promise.all(
    Array.from(owner.styleSheets).map(async (sheet) => {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        throw new Error(knowledgeT('unableToReadDocumentFontStylesAllowAccess'));
      }
      await collectFonts(rules, sheet.href ?? owner.baseURI);
    }),
  );
  const rootStyle = view.getComputedStyle(source);
  const frameStyle = view.getComputedStyle(
    source.closest('[data-knowledge-editor]') ?? source.parentElement ?? source,
  );
  clone.style.width = `min(calc(100% - 48px),${source.getBoundingClientRect().width || parseFloat(rootStyle.width) || 830}px)`;
  clone.style.maxWidth = 'none';
  clone.style.height = 'auto';
  clone.style.minHeight = '0';
  clone.style.margin = '0 auto';
  clone.querySelectorAll('[data-export-id]').forEach((element) => {
    const style = (element as HTMLElement).style;
    // Text flows naturally on a smaller viewport; preserve explicit media/table/column dimensions.
    if (
      !element.matches('img,video,audio,svg,svg *,table,col,colgroup,td,th') &&
      !element.closest('.katex')
    ) {
      style.height = 'auto';
      if (
        !element.matches('[data-column], [data-columns] *') &&
        style.display !== 'flex' &&
        style.display !== 'grid'
      )
        style.width = 'auto';
    }
  });
  if (source === prose) {
    const heading = owner.createElement('h1');
    heading.textContent = title.trim() || knowledgeT('untitledDocument');
    heading.style.cssText = `font-family:${rootStyle.fontFamily};font-size:36px;line-height:1.18;margin:0 0 25px;font-weight:700`;
    clone.prepend(heading);
  }
  const backgroundImage = await inlineUrls(frameStyle.backgroundImage);
  const css = `*{box-sizing:border-box}html,body{margin:0;min-height:100%}body{background-color:${frameStyle.backgroundColor};background-image:${backgroundImage};background-size:${frameStyle.backgroundSize};background-position:${frameStyle.backgroundPosition};background-repeat:${frameStyle.backgroundRepeat};color:${rootStyle.color};font-family:${rootStyle.fontFamily}}img,video{max-width:100%;height:auto}pre{max-width:100%;overflow-x:auto}${fontRules.join('\n')}${pseudoRules.join('\n')}@media print{*{print-color-adjust:exact}img,tr,pre{break-inside:avoid}}@page{margin:18mm}`;
  return `<!doctype html>\n<html lang="${getLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeDocumentHtml(title.trim() || knowledgeT('untitledDocument'))}</title><style>${css.replaceAll('<', '\\3c ')}</style></head><body>${clone.outerHTML}</body></html>`;
}
