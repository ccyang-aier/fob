import { integerAttribute, nullableString, stringAttribute } from './attributes';
import { defineBlock } from './types';
import { safeKnowledgeUrl } from './urls';
import { parseWhiteboardScene } from '../rich-content';

const boundedText = (limit: number) => ({ default: '', validate(value: unknown) { if (typeof value !== 'string' || value.length > limit) throw new RangeError('Rich content text is too long'); } });
export const RICH_CONTENT_BLOCKS = [
  defineBlock({
    name: 'linkCard',
    schema: { atom: true, draggable: true, attrs: { url: stringAttribute, title: boundedText(500), description: boundedText(2000), image: boundedText(4096), siteName: boundedText(200), fetched: { default: false, validate: 'boolean' } },
      toDOM: node => ['figure', { 'data-link-card': '' }, ['a', { href: safeKnowledgeUrl(node.attrs.url, 'link'), rel: 'noopener noreferrer' }, node.attrs.title || node.attrs.url], ['p', node.attrs.description]] },
    markdown: { fromMd: { directive: 'link-card', kind: 'leaf' } }, index: { mode: 'text' },
    slash: { title: '链接卡片', keywords: ['bookmark', 'link', 'card', '链接', '书签', '网页'], group: 'media' },
  }),
  defineBlock({
    name: 'mermaid',
    schema: { atom: true, draggable: true, attrs: { source: boundedText(50_000), title: boundedText(500), height: integerAttribute(360, 200, 1200) },
      toDOM: node => ['pre', { 'data-mermaid': '' }, ['code', { class: 'language-mermaid' }, node.attrs.source]] },
    markdown: { fromMd: { type: 'code', variant: 'mermaid' } }, index: { mode: 'text' },
    slash: { title: 'Mermaid 图表', keywords: ['mermaid', 'diagram', 'flowchart', '图表', '流程图', '时序图', '脑图'], group: 'media' },
  }),
  defineBlock({
    name: 'pdf',
    schema: { atom: true, draggable: true, attrs: { src: stringAttribute, title: nullableString, alt: stringAttribute, caption: stringAttribute, mime: { default: 'application/pdf', validate: 'string' }, height: integerAttribute(520, 240, 1200) },
      toDOM: node => ['figure', { 'data-pdf': '' }, ['a', { href: safeKnowledgeUrl(node.attrs.src, 'media') }, node.attrs.title || 'PDF']] },
    markdown: { fromMd: { directive: 'pdf', kind: 'leaf' } }, index: { mode: 'media' },
    slash: { title: 'PDF 预览', keywords: ['pdf', 'document', '论文', '报告', '预览'], group: 'media' },
  }),
  defineBlock({
    name: 'whiteboard',
    schema: { atom: true, draggable: true, attrs: { title: boundedText(500), height: integerAttribute(400, 200, 1200), preview: { default: '', validate(value: unknown) { if (typeof value !== 'string' || value.length > 8 * 1024 * 1024 || value !== '' && !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z\d+/=]*$/.test(value)) throw new TypeError('Invalid whiteboard PNG preview'); } }, previewHash: { default: '', validate(value: unknown) { if (typeof value !== 'string' || value !== '' && !/^[a-f0-9]{64}$/.test(value)) throw new TypeError('Invalid whiteboard preview hash'); } }, scene: { default: '', validate(value: unknown) { if (typeof value !== 'string') throw new TypeError('Invalid whiteboard scene'); parseWhiteboardScene(value); } } },
      toDOM: node => ['figure', { 'data-whiteboard': '' }, node.attrs.title || 'Excalidraw'] },
    markdown: { fromMd: { directive: 'whiteboard', kind: 'leaf' } }, index: { mode: 'text' },
    slash: { title: 'Excalidraw 白板', keywords: ['excalidraw', 'whiteboard', 'drawing', '白板', '画板', '草图'], group: 'media' },
  }),
];
