import { integerAttribute, nullableString, stringAttribute } from './attributes';
import { defineBlock } from './types';
import { safeKnowledgeUrl } from './urls';
import { DEFAULT_MERMAID_THEME, isMermaidTheme, parseWhiteboardScene } from '../rich-content';

const boundedText = (limit: number) => ({ default: '', validate(value: unknown) { if (typeof value !== 'string' || value.length > limit) throw new RangeError('Rich content text is too long'); } });
export const RICH_CONTENT_BLOCKS = [
  defineBlock({
    name: 'emoji',
    schema: {
      atom: true, draggable: true,
      attrs: { value: { default: '😀', validate(value: unknown) {
        if (typeof value !== 'string' || value.length === 0 || value.length > 64 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Invalid emoji value');
      } } },
      leafText: node => String(node.attrs.value),
      toDOM: node => ['div', { 'data-emoji-block': '', 'data-emoji-value': node.attrs.value }, node.attrs.value],
    },
    markdown: { fromMd: { directive: 'emoji', kind: 'leaf' } }, index: { mode: 'text' },
    ai: { describe: node => String(node.attrs.value) },
    slash: { title: '表情块', keywords: ['emoji', 'emoticon', 'smiley', '表情', '表情块'], group: 'media' },
  }),
  defineBlock({
    name: 'linkCard',
    schema: { atom: true, draggable: true, attrs: { url: stringAttribute, title: boundedText(500), description: boundedText(2000), image: boundedText(4096), siteName: boundedText(200), fetched: { default: false, validate: 'boolean' } },
      toDOM: node => ['figure', { 'data-link-card': '' }, ['a', { href: safeKnowledgeUrl(node.attrs.url, 'link'), rel: 'noopener noreferrer' }, node.attrs.title || node.attrs.url], ['p', node.attrs.description]] },
    markdown: { fromMd: { directive: 'link-card', kind: 'leaf' } }, index: { mode: 'text' },
    slash: { title: '链接卡片', keywords: ['bookmark', 'link', 'card', '链接', '书签', '网页'], group: 'media' },
  }),
  defineBlock({
    name: 'mermaid',
    schema: { atom: true, draggable: true, attrs: { source: boundedText(50_000), title: boundedText(500), theme: { default: DEFAULT_MERMAID_THEME, validate(value: unknown) { if (!isMermaidTheme(value)) throw new TypeError('Invalid Mermaid theme'); } }, width: integerAttribute(100, 25, 100), height: integerAttribute(360, 80, 1200), autoHeight: { default: true, validate: 'boolean' } },
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
    schema: { atom: true, draggable: true, attrs: { title: boundedText(500), width: integerAttribute(100, 25, 100), height: integerAttribute(400, 80, 1200), autoHeight: { default: true, validate: 'boolean' }, preview: { default: '', validate(value: unknown) { if (typeof value !== 'string' || value.length > 8 * 1024 * 1024 || value !== '' && !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z\d+/=]*$/.test(value)) throw new TypeError('Invalid whiteboard PNG preview'); } }, previewHash: { default: '', validate(value: unknown) { if (typeof value !== 'string' || value !== '' && !/^[a-f0-9]{64}$/.test(value)) throw new TypeError('Invalid whiteboard preview hash'); } }, scene: { default: '', validate(value: unknown) { if (typeof value !== 'string') throw new TypeError('Invalid whiteboard scene'); parseWhiteboardScene(value); } } },
      toDOM: node => ['figure', { 'data-whiteboard': '' }, node.attrs.title || 'Excalidraw'] },
    markdown: { fromMd: { directive: 'whiteboard', kind: 'leaf' } }, index: { mode: 'text' },
    slash: { title: 'Excalidraw 白板', keywords: ['excalidraw', 'whiteboard', 'drawing', '白板', '画板', '草图'], group: 'media' },
  }),
];
