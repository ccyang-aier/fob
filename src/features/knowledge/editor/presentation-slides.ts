import { createTranslator, getLocale, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './presentation-slides.messages';
import { escapeDocumentHtml } from './components/document-html-export';

/** Use the exact rendered blocks and embedded assets, grouping at H1/H2 boundaries. */
export function presentationSlides(
  html: string,
  title: string,
  locale: Locale = getLocale(),
): string[] {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const prose = parsed.querySelector('.ProseMirror') ?? parsed.body.firstElementChild;
  const groups: string[][] = [
    [`<h1>${escapeDocumentHtml(title || knowledgeT('untitledDocument'))}</h1>`],
  ];
  for (const child of Array.from(prose?.children ?? [])) {
    if (/^H[12]$/.test(child.tagName) && groups[groups.length - 1].length > 1) groups.push([]);
    groups[groups.length - 1].push(child.outerHTML);
  }
  return groups.map(
    (group) =>
      `<!doctype html><html lang="${locale}">${parsed.head.outerHTML}<body><main>${group.join('\n')}</main><style>html,body{height:100%;background:#fff!important}main{width:min(100% - 96px,1100px);margin:auto;padding:50px 0;line-height:1.8;font-size:22px}main>h1{font-size:42px;font-weight:700;line-height:1.3;margin:0 0 32px}main>*{max-width:100%!important}main>h2{margin-top:0!important}main pre{white-space:pre-wrap}main img,main video{max-height:65vh;object-fit:contain}main [data-export-id]{min-height:0!important}body{overflow:auto}</style></body></html>`,
  );
}
