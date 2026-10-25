import type { NodeSpec } from '@tiptap/pm/model';

import { integerAttribute, nullableObject, nullableString, stringAttribute } from './attributes';
import { defineBlock } from './types';
import type { BlockDefinition } from './types';
import { safeKnowledgeUrl } from './urls';
import { RICH_CONTENT_BLOCKS } from './rich-blocks';

const textBlock = (tag: string): NodeSpec => ({
  content: 'inline*',
  parseDOM: [{ tag }],
  toDOM: () => [tag, 0],
});

const colorAttribute = {
  default: null,
  validate(value: unknown) {
    if (value !== null && (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value))) {
      throw new TypeError('Expected a six- or eight-digit hex color or null');
    }
  },
};

const cellAttributes: NodeSpec['attrs'] = {
  align: {
    default: null,
    validate(value: unknown) {
      if (value !== null && value !== 'left' && value !== 'right' && value !== 'center') throw new RangeError('Unknown table alignment');
    },
  },
  colspan: integerAttribute(1, 1),
  rowspan: integerAttribute(1, 1),
  colwidth: {
    default: null,
    validate(value: unknown) {
      if (value !== null && (!Array.isArray(value) || value.some((width) => !Number.isSafeInteger(width) || width < 0))) {
        throw new TypeError('Column widths must be non-negative integers or null');
      }
    },
  },
  background: colorAttribute,
};

const choice = (values: readonly string[], fallback: string) => ({
  default: fallback,
  validate(value: unknown) {
    if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`Unknown choice: ${String(value)}`);
  },
});

function mediaBlock(name: 'image' | 'video' | 'audio' | 'file', title: string): BlockDefinition {
  return defineBlock({
    name,
    schema: {
      atom: true,
      draggable: true,
      attrs: { src: stringAttribute, alt: stringAttribute, title: nullableString, caption: stringAttribute, mime: nullableString },
      parseDOM: name === 'file' ? [] : [{
        tag: `${name === 'image' ? 'img' : name}[src]`,
        getAttrs: (element) => ({ src: element.getAttribute('src'), alt: element.getAttribute('alt') ?? '', title: element.getAttribute('title') }),
      }],
      toDOM: (node) => name === 'file'
        ? ['figure', { 'data-file': safeKnowledgeUrl(node.attrs.src, 'media') }, node.attrs.title || node.attrs.src || '文件']
        : ['figure', [name === 'image' ? 'img' : name, { src: safeKnowledgeUrl(node.attrs.src, 'media'), alt: node.attrs.alt, title: node.attrs.title, ...(name === 'image' ? {} : { controls: '' }) }]],
    },
    markdown: { fromMd: name === 'image' ? { type: 'image' } : { directive: name, kind: 'leaf' } },
    index: { mode: 'media' },
    slash: { title, keywords: [name, title], group: 'media' },
  });
}

/** One first-party definition per block; browser NodeViews decorate these extensions. */
export const KNOWLEDGE_BLOCKS: readonly BlockDefinition[] = Object.freeze([
  defineBlock({
    name: 'paragraph', schema: textBlock('p'), markdown: { fromMd: { type: 'paragraph' } }, index: { mode: 'text' },
    slash: { title: '正文', keywords: ['text', 'paragraph', '正文'], group: 'text' },
  }),
  defineBlock({
    name: 'heading',
    schema: {
      content: 'inline*', defining: true, attrs: { level: integerAttribute(2, 1, 6) },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    markdown: { fromMd: { type: 'heading' } }, index: { mode: 'text' },
    slash: { title: '标题', keywords: ['heading', '标题'], group: 'text' },
  }),
  defineBlock({
    name: 'bulletList', schema: { content: 'listItem+', parseDOM: [{ tag: 'ul:not([data-task-list])' }], toDOM: () => ['ul', 0] },
    markdown: { fromMd: { type: 'list', variant: 'unordered' } }, index: { mode: 'skip' },
    slash: { title: '无序列表', keywords: ['bullet', 'list', '列表'], group: 'text' },
  }),
  defineBlock({
    name: 'orderedList',
    schema: {
      content: 'listItem+', attrs: { start: integerAttribute(1, 0) },
      parseDOM: [{ tag: 'ol', getAttrs: (element) => ({ start: Number(element.getAttribute('start') ?? 1) }) }],
      toDOM: (node) => ['ol', { start: node.attrs.start }, 0],
    },
    markdown: { fromMd: { type: 'list', variant: 'ordered' } }, index: { mode: 'skip' },
    slash: { title: '有序列表', keywords: ['ordered', 'number', '列表'], group: 'text' },
  }),
  defineBlock({
    name: 'listItem', schema: { group: '', content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li:not([data-task-item])' }], toDOM: () => ['li', 0] },
    markdown: { fromMd: { type: 'listItem', variant: 'plain' } }, index: { mode: 'text' },
  }),
  defineBlock({
    name: 'taskList',
    schema: {
      content: 'taskItem+', attrs: { ordered: { default: false, validate: 'boolean' }, start: integerAttribute(1, 0) },
      parseDOM: ['ul', 'ol'].map((tag) => ({ tag: `${tag}[data-task-list]`, getAttrs: (element) => ({ ordered: tag === 'ol', start: Number(element.getAttribute('start') ?? 1) }) })),
      toDOM: (node) => [node.attrs.ordered ? 'ol' : 'ul', { 'data-task-list': '', ...(node.attrs.ordered ? { start: node.attrs.start } : {}) }, 0],
    },
    markdown: { fromMd: { type: 'list', variant: 'task' } }, index: { mode: 'skip' },
    slash: { title: '待办列表', keywords: ['todo', 'task', '待办'], group: 'text' },
  }),
  defineBlock({
    name: 'taskItem',
    schema: {
      group: '', content: 'paragraph block*', defining: true, attrs: { checked: { default: false, validate: 'boolean' } },
      parseDOM: [{ tag: 'li[data-task-item]', getAttrs: (element) => ({ checked: element.getAttribute('data-checked') === 'true' }) }],
      toDOM: (node) => ['li', { 'data-task-item': '', 'data-checked': String(node.attrs.checked) }, 0],
    },
    markdown: { fromMd: { type: 'listItem', variant: 'task' } }, index: { mode: 'text' },
  }),
  defineBlock({
    name: 'blockquote', schema: { content: 'block+', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
    markdown: { fromMd: { type: 'blockquote' } }, index: { mode: 'text' },
    slash: { title: '引用', keywords: ['quote', '引用'], group: 'text' },
  }),
  defineBlock({
    name: 'callout',
    schema: { content: 'block+', defining: true, attrs: { emoji: { default: '💡', validate: 'string' }, tone: { default: 'neutral', validate: 'string' } }, toDOM: (node) => ['aside', { 'data-emoji': node.attrs.emoji, 'data-tone': node.attrs.tone }, 0] },
    markdown: { fromMd: { directive: 'callout', kind: 'container' } }, index: { mode: 'text' },
    ai: { describe: (node) => `提示框：${node.textContent}` },
    slash: { title: '提示框', keywords: ['callout', 'tip', '提示'], group: 'text' },
  }),
  defineBlock({
    name: 'codeBlock',
    schema: {
      content: 'text*', marks: 'comment suggestion_insert suggestion_delete', code: true, defining: true,
      attrs: {
        language: nullableString,
        theme: choice(['light', 'dark', 'paper', 'monokai', 'idea', 'darcula', 'nord', 'one-dark'], 'light'),
        lineNumbers: { default: true, validate: 'boolean' },
        wrap: { default: false, validate: 'boolean' },
      },
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: (element) => ({
        language: element.getAttribute('data-language') || element.querySelector('code')?.className.match(/language-([\w-]+)/)?.[1] || null,
        theme: element.getAttribute('data-theme') || 'light',
        lineNumbers: element.getAttribute('data-line-numbers') !== 'false',
        wrap: element.getAttribute('data-wrap') === 'true',
      }) }],
      toDOM: (node) => ['pre', {
        'data-language': node.attrs.language,
        'data-theme': node.attrs.theme,
        'data-line-numbers': String(node.attrs.lineNumbers),
        'data-wrap': String(node.attrs.wrap),
      }, ['code', { class: node.attrs.language ? `language-${node.attrs.language}` : null }, 0]],
    },
    markdown: { fromMd: { type: 'code' } }, index: { mode: 'text' },
    slash: { title: '代码', keywords: ['code', '代码'], group: 'text' },
  }),
  defineBlock({
    name: 'math', schema: { atom: true, attrs: { latex: stringAttribute }, parseDOM: [{ tag: 'div[data-math]', getAttrs: (element) => ({ latex: element.getAttribute('data-latex') ?? element.textContent ?? '' }) }], toDOM: (node) => ['div', { 'data-math': '', 'data-latex': node.attrs.latex }, node.attrs.latex] },
    markdown: { fromMd: { type: 'math' } }, index: { mode: 'text' },
    slash: { title: '数学公式', keywords: ['math', 'latex', '公式'], group: 'text' },
  }),
  defineBlock({
    name: 'horizontalRule', schema: { atom: true, parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
    markdown: { fromMd: { type: 'thematicBreak' } }, index: { mode: 'skip' },
    slash: { title: '分隔线', keywords: ['divider', '分隔线'], group: 'layout' },
  }),
  defineBlock({
    name: 'table', schema: { content: 'tableRow+', isolating: true, tableRole: 'table', attrs: { variant: choice(['plain', 'striped', 'minimal'], 'plain'), background: colorAttribute }, parseDOM: [{ tag: 'table', getAttrs: (element) => ({ variant: element.getAttribute('data-variant') || 'plain', background: element.getAttribute('data-background') }) }], toDOM: (node) => ['table', { 'data-variant': node.attrs.variant, 'data-background': node.attrs.background, style: node.attrs.background ? `background-color:${node.attrs.background}` : null }, ['tbody', 0]] },
    markdown: { fromMd: { type: 'table' } }, index: { mode: 'skip' },
    slash: { title: '表格', keywords: ['table', '表格'], group: 'layout' },
  }),
  defineBlock({
    name: 'tableRow', schema: { group: '', content: '(tableCell | tableHeader)*', tableRole: 'row', attrs: { background: colorAttribute }, parseDOM: [{ tag: 'tr', getAttrs: (element) => ({ background: element.getAttribute('data-background') }) }], toDOM: (node) => ['tr', { 'data-background': node.attrs.background, style: node.attrs.background ? `background-color:${node.attrs.background}` : null }, 0] },
    markdown: { fromMd: { type: 'tableRow' } }, index: { mode: 'skip' },
  }),
  ...(['tableCell', 'tableHeader'] as const).map((name) => defineBlock({
    name,
    schema: {
      group: '', content: 'block+', isolating: true, tableRole: name === 'tableCell' ? 'cell' : 'header_cell', attrs: cellAttributes,
      parseDOM: [{ tag: name === 'tableCell' ? 'td' : 'th', getAttrs: (element) => ({ colspan: Number(element.getAttribute('colspan') ?? 1), rowspan: Number(element.getAttribute('rowspan') ?? 1), align: element.getAttribute('align'), background: element.getAttribute('data-background') }) }],
      toDOM: (node) => [name === 'tableCell' ? 'td' : 'th', { colspan: node.attrs.colspan, rowspan: node.attrs.rowspan, align: node.attrs.align, 'data-background': node.attrs.background, style: node.attrs.background ? `background-color:${node.attrs.background}` : null }, 0],
    },
    markdown: { fromMd: { type: 'tableCell', variant: name === 'tableHeader' ? 'header' : 'cell' } }, index: { mode: 'text' },
  })),
  defineBlock({
    name: 'columns', schema: { content: 'column{2,}', isolating: true, attrs: { variant: choice(['cards', 'dividers', 'plain'], 'cards') }, parseDOM: [{ tag: 'div[data-columns]', getAttrs: element => ({ variant: element.getAttribute('data-variant') || 'cards' }) }], toDOM: node => ['div', { 'data-columns': '', 'data-variant': node.attrs.variant }, 0] },
    markdown: { fromMd: { directive: 'columns', kind: 'container' } }, index: { mode: 'skip' },
    slash: { title: '分栏', keywords: ['columns', '分栏'], group: 'layout' },
  }),
  defineBlock({
    name: 'column', schema: { group: '', content: 'block+', isolating: true, attrs: { width: integerAttribute(1, 1) }, parseDOM: [{ tag: 'div[data-column]', getAttrs: (element) => ({ width: Number(element.getAttribute('data-width') ?? 1) }) }], toDOM: (node) => ['div', { 'data-column': '', 'data-width': node.attrs.width, style: `--column-width:${node.attrs.width}` }, 0] },
    markdown: { fromMd: { directive: 'column', kind: 'container' } }, index: { mode: 'skip' },
  }),
  mediaBlock('image', '图片'), mediaBlock('video', '视频'), mediaBlock('audio', '音频'), mediaBlock('file', '文件'),
  defineBlock({
    name: 'embed', schema: { atom: true, attrs: { url: stringAttribute, title: stringAttribute, height: integerAttribute(400, 200, 1200) }, toDOM: (node) => ['div', { 'data-embed': safeKnowledgeUrl(node.attrs.url, 'media') }, node.attrs.title || node.attrs.url] },
    markdown: { fromMd: { directive: 'embed', kind: 'leaf' } }, index: { mode: 'text' },
    slash: { title: '嵌入', keywords: ['embed', '嵌入', 'bilibili', 'b站', '哔哩哔哩', 'youtube', 'vimeo'], group: 'media' },
  }),
  ...RICH_CONTENT_BLOCKS,
  defineBlock({
    name: 'blockReference', schema: { atom: true, attrs: { knowledgeBaseId: nullableString, pageId: nullableString, targetBlockId: nullableString }, toDOM: (node) => ['div', { 'data-block-reference': node.attrs.targetBlockId }, '块引用'] },
    markdown: { fromMd: { directive: 'block-reference', kind: 'leaf' } }, index: { mode: 'skip' },
    slash: { title: '块引用', keywords: ['reference', '引用'], group: 'knowledge' },
  }),
  defineBlock({
    name: 'pageLink', schema: { atom: true, attrs: { knowledgeBaseId: nullableString, pageId: nullableString, title: stringAttribute }, toDOM: (node) => ['div', { 'data-page-link': node.attrs.pageId }, node.attrs.title || '页面链接'] },
    markdown: { fromMd: { directive: 'page-link', kind: 'leaf' } }, index: { mode: 'text' },
    slash: { title: '页面链接', keywords: ['page', 'link', '页面'], group: 'knowledge' },
  }),
  defineBlock({
    name: 'databaseView',
    schema: {
      atom: true, isolating: true,
      attrs: { databaseId: nullableString, view: { default: 'table', validate(value: unknown) { if (typeof value !== 'string' || !['table', 'board', 'calendar'].includes(value)) throw new RangeError('Unknown database view'); } }, config: nullableObject },
      toDOM: (node) => ['div', { 'data-database-view': node.attrs.view }, '数据库视图'],
    },
    markdown: { fromMd: { directive: 'database-view', kind: 'leaf' } }, index: { mode: 'skip' },
    slash: { title: '数据库视图', keywords: ['database', '数据库', '看板', '日历'], group: 'knowledge' },
  }),
  defineBlock({
    name: 'aiBlock',
    schema: {
      content: 'block+', defining: true, isolating: true,
      attrs: { prompt: stringAttribute, scope: nullableObject, schedule: nullableString, taskId: nullableString, tier: choice(['fast', 'smart'], 'fast') },
      toDOM: () => ['section', { 'data-ai-block': '' }, 0],
    },
    markdown: { fromMd: { directive: 'ai', kind: 'container' } }, index: { mode: 'text' },
    slash: { title: 'AI 块', keywords: ['ai', '智能'], group: 'ai' },
  }),
]);
