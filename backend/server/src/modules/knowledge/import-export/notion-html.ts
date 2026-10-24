import { NodeType, parse } from 'node-html-parser';
import type { HTMLElement, Node } from 'node-html-parser';
import type { MarkdownNode } from '@fob/shared/knowledge/markdown';
import { inferNotionColumns } from './notion-csv';
import type { NotionImportWarning, NotionParsedDatabase, NotionParsedPage, NotionParsedRow } from './notion-types';

/**
 * Notion HTML 导出 → M01 mdast。语义优先:标准 HTML 元素决定结构(h1-h6/p/ul/ol/
 * blockquote/pre/table/figure),Notion 类名只作修饰提示(to-do-list/checkbox-on/
 * callout/code/lang-name/katex)。无法一一映射的元素(折叠块、彩色文字、复杂嵌入)
 * 降级保内容并逐项告警,绝不静默丢弃。
 */

type Md = MarkdownNode;

export interface NotionHtmlOptions {
  /** 相对 href 是否指向导出内存在的页面文件;数据库页检测依赖它。 */
  readonly linkTargetExists: (href: string) => boolean;
}

const KATEX_TEX = 'application/x-tex';
const COLOR_CLASS = /^block-color-([a-z_]+?)(?:_background)?$/;

const text = (node: Node): string => (node.nodeType === NodeType.TEXT_NODE ? (node as { text: string }).text : '');

/** HTML 显示语义:任意空白串折叠为单空格。 */
const collapse = (value: string): string => value.replace(/[\t\n\f\r ]+/g, ' ');

class Converter {
  readonly warnings: NotionImportWarning[] = [];

  constructor(
    private readonly source: string,
    private readonly options: NotionHtmlOptions,
  ) {}

  private warn(code: NotionImportWarning['code'], detail: string): void {
    this.warnings.push({ source: this.source, code, detail });
  }

  // ---------- 行内 ----------

  /** 从 KaTeX 渲染 HTML 中恢复原始 LaTeX(annotation 是唯一无损来源)。 */
  private latex(element: HTMLElement): string | null {
    const annotation = element.querySelectorAll('annotation').find((node) => node.getAttribute('encoding') === KATEX_TEX);
    return annotation ? annotation.text : null;
  }

  private colorTone(element: HTMLElement): { color: string; background: boolean } | null {
    for (const name of element.classList.values()) {
      const match = COLOR_CLASS.exec(name);
      if (match) return { color: match[1]!, background: name.endsWith('_background') };
    }
    return null;
  }

  inline(nodes: readonly Node[]): Md[] {
    const result: Md[] = [];
    for (const node of nodes) {
      if (node.nodeType === NodeType.COMMENT_NODE) continue;
      if (node.nodeType === NodeType.TEXT_NODE) {
        const value = collapse(text(node));
        if (value) result.push({ type: 'text', value });
        continue;
      }
      const element = node as HTMLElement;
      result.push(...this.inlineElement(element));
    }
    return result;
  }

  private inlineElement(element: HTMLElement): Md[] {
    const tag = element.tagName.toLowerCase();
    const children = () => this.inline(element.childNodes);
    switch (tag) {
      case 'strong': case 'b':
        return [{ type: 'strong', children: children() }];
      case 'em': case 'i':
        if (element.classList.contains('underline')) return [{ type: 'textDirective', name: 'underline', attributes: {}, children: children() }];
        return [{ type: 'emphasis', children: children() }];
      case 'u':
        return [{ type: 'textDirective', name: 'underline', attributes: {}, children: children() }];
      case 'code':
        return [{ type: 'inlineCode', value: element.text }];
      case 's': case 'del': case 'strike':
        return [{ type: 'delete', children: children() }];
      case 'br':
        return [{ type: 'break' }];
      case 'img': {
        const src = element.getAttribute('src') ?? '';
        return src ? [{ type: 'image', url: src, alt: element.getAttribute('alt') ?? '' }] : [];
      }
      case 'a': {
        const href = element.getAttribute('href') ?? '';
        return href ? [{ type: 'link', url: href, title: null, children: children() }] : children();
      }
      case 'mark':
        return [{ type: 'textDirective', name: 'highlight', attributes: {}, children: children() }];
      case 'span': {
        if (element.classList.contains('katex')) {
          const latex = this.latex(element);
          if (latex === null) {
            this.warn('complex_equation', '行内公式缺少 LaTeX 注记,已保留渲染文本');
            return children();
          }
          return latex ? [{ type: 'inlineMath', value: latex }] : [];
        }
        const color = this.colorTone(element);
        if (color && color.background) {
          return [{ type: 'textDirective', name: 'highlight', attributes: { color: color.color }, children: children() }];
        }
        if (color) {
          this.warn('colored_text', `文字颜色 ${color.color} 无对应 mark,内容保留、颜色丢弃`);
        }
        return children();
      }
      case 'sup': case 'sub': case 'font': case 'small': case 'abbr': case 'time': case 'label':
        return children();
      default:
        return children();
    }
  }

  /** 单元格/属性场景的纯文本视图;多值分隔符由原始 HTML 文本节点携带。 */
  inlineText(nodes: readonly Node[]): string {
    const value = this.inline(nodes).map(inlinePlainText).join('');
    return collapse(value).trim();
  }

  // ---------- 块级 ----------

  blocks(nodes: readonly Node[]): Md[] {
    const result: Md[] = [];
    for (const node of nodes) {
      if (node.nodeType === NodeType.COMMENT_NODE || node.nodeType === NodeType.TEXT_NODE) continue;
      result.push(...this.blockElement(node as HTMLElement));
    }
    return result;
  }

  /** li/引用/提示框/单元格内容:行内片段聚成段落,块级子元素保持块。 */
  private mixed(nodes: readonly Node[]): Md[] {
    const result: Md[] = [];
    let run: Md[] = [];
    const flush = () => {
      const paragraph = this.paragraph(run);
      if (paragraph) result.push(paragraph);
      run = [];
    };
    for (const node of nodes) {
      if (node.nodeType === NodeType.TEXT_NODE) {
        const value = collapse(text(node));
        if (value) run.push({ type: 'text', value });
        continue;
      }
      if (node.nodeType === NodeType.COMMENT_NODE) continue;
      const element = node as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'figure', 'table', 'hr', 'div', 'details'].includes(tag)) {
        flush();
        result.push(...this.blockElement(element));
      } else run.push(...this.inlineElement(element));
    }
    flush();
    return result;
  }

  private paragraph(children: readonly Md[]): Md | null {
    const content = children.filter((node) => node.type !== 'text' || node.value !== '');
    while (content.length && content[0]!.type === 'text' && content[0]!.value === ' ') content.shift();
    while (content.length && content.at(-1)!.type === 'text' && content.at(-1)!.value === ' ') content.pop();
    if (!content.length) return null;
    return { type: 'paragraph', children: content };
  }

  private blockElement(element: HTMLElement): Md[] {
    const tag = element.tagName.toLowerCase();
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const depth = Number(tag.slice(1));
        return [{ type: 'heading', depth, children: this.inline(element.childNodes) }];
      }
      case 'p': {
        const color = this.colorTone(element);
        if (color) this.warn('colored_block', `段落文字颜色 ${color.color} 无对应属性,颜色丢弃`);
        const paragraph = this.paragraph(this.inline(element.childNodes));
        return paragraph ? [paragraph] : [];
      }
      case 'ul': case 'ol':
        return this.list(element, tag === 'ol');
      case 'blockquote': {
        if (this.colorTone(element)) this.warn('colored_block', '彩色引用的背景色无对应属性,颜色丢弃');
        return [{ type: 'blockquote', children: this.mixed(element.childNodes) }];
      }
      case 'pre':
        return this.codeBlock(element.closest('figure') ?? element);
      case 'hr':
        return [{ type: 'thematicBreak' }];
      case 'table':
        return this.tableElement(element);
      case 'figure':
        return this.figure(element);
      case 'details':
        return this.toggle(element);
      case 'div': {
        if (element.classList.contains('indented')) {
          const inner = this.blocks(element.childNodes);
          return inner.length ? (this.warn('indent_flattened', '缩进块在目标块模型中不可嵌套,已平铺为同级块'), inner) : [];
        }
        return this.blocks(element.childNodes);
      }
      case 'article': case 'body': case 'header': case 'main': case 'section': case 'aside': case 'nav':
        return this.blocks(element.childNodes);
      default:
        return this.mixed([element]);
    }
  }

  private codeBlock(figure: Node): Md[] {
    const holder = figure.nodeType === NodeType.ELEMENT_NODE ? (figure as HTMLElement) : undefined;
    const pre = holder?.querySelector('pre') ?? (holder && holder.tagName.toLowerCase() === 'pre' ? holder : undefined);
    if (!pre) return [];
    const code = pre.querySelector('code') ?? pre;
    const language = holder?.querySelector('.lang-name')?.text.trim()
      ?? /language-([\w-]+)/.exec(code.getAttribute('class') ?? '')?.[1]
      ?? null;
    const value = code.text.replace(/^\n/, '').replace(/\n$/, '');
    return [{ type: 'code', lang: language, value }];
  }

  private list(list: HTMLElement, ordered: boolean): Md[] {
    const items = list.childNodes.filter((node): node is HTMLElement =>
      node.nodeType === NodeType.ELEMENT_NODE && (node as HTMLElement).tagName.toLowerCase() === 'li');
    if (list.classList.contains('toggle')) {
      const result: Md[] = [];
      for (const item of items) result.push(...this.toggleItem(item));
      return result;
    }
    const task = list.classList.contains('to-do-list');
    const start = ordered ? Number(list.getAttribute('start') ?? 1) || 1 : 1;
    const children: Md[] = items.map((item) => {
      const itemTask = task || item.querySelector('.checkbox') !== null || item.querySelector('input[type="checkbox"]') !== null;
      return { type: 'listItem', checked: itemTask ? taskItemChecked(item) : null, spread: false, children: this.listItemChildren(item) };
    });
    if (!children.length) return [];
    return [{ type: 'list', ordered, start, spread: false, children }];
  }

  /** li 内容 = 行内片段段落 + 嵌套列表/缩进块(允许无首段,解码器会补空段)。 */
  private listItemChildren(item: HTMLElement): Md[] {
    const blocks: Md[] = [];
    let run: Md[] = [];
    const flush = () => {
      const paragraph = this.paragraph(run);
      if (paragraph) blocks.push(paragraph);
      run = [];
    };
    for (const node of item.childNodes) {
      if (node.nodeType === NodeType.TEXT_NODE) {
        const value = collapse(text(node));
        if (value) run.push({ type: 'text', value });
        continue;
      }
      if (node.nodeType === NodeType.COMMENT_NODE) continue;
      const element = node as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'details') {
        flush();
        if (tag === 'div' && !element.classList.contains('indented')) blocks.push(...this.blocks(element.childNodes));
        else blocks.push(...this.blockElement(element));
      } else if (tag === 'figure' || tag === 'table' || tag === 'hr' || tag === 'pre' || tag === 'blockquote' || /^h[1-6]$/.test(tag) || tag === 'p') {
        flush();
        blocks.push(...this.blockElement(element));
      } else run.push(...this.inlineElement(element));
    }
    flush();
    return blocks;
  }

  private toggle(details: HTMLElement): Md[] {
    this.warn('toggle_collapsed', '折叠块导出后无折叠语义,标题与内容平铺为顺序块');
    return this.toggleContent(details);
  }

  private toggleItem(item: HTMLElement): Md[] {
    this.warn('toggle_collapsed', '折叠块导出后无折叠语义,标题与内容平铺为顺序块');
    const details = item.querySelector('details');
    return details ? this.toggleContent(details) : this.mixed(item.childNodes);
  }

  private toggleContent(details: HTMLElement): Md[] {
    const summary = details.childNodes.find((node): node is HTMLElement =>
      node.nodeType === NodeType.ELEMENT_NODE && (node as HTMLElement).tagName.toLowerCase() === 'summary');
    const result: Md[] = [];
    if (summary) {
      const paragraph = this.paragraph(this.inline(summary.childNodes));
      if (paragraph) result.push(paragraph);
    }
    for (const node of details.childNodes) {
      if (node === summary) continue;
      if (node.nodeType === NodeType.ELEMENT_NODE) result.push(...this.blockElement(node as HTMLElement));
      else if (node.nodeType === NodeType.TEXT_NODE) {
        const value = collapse(text(node));
        if (value.trim()) result.push({ type: 'paragraph', children: [{ type: 'text', value: value.trim() }] });
      }
    }
    return result;
  }

  // ---------- 媒体与 figure ----------

  /** 媒体块带 caption/mime 等属性,超出 image 语法;走 fob-block 规范信封保留全部属性。 */
  private mediaEnvelope(type: 'image' | 'video' | 'audio' | 'file', attrs: Record<string, string>): Md {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(attrs)) if (value !== '') values[key] = value;
    return { type: 'leafDirective', name: 'fob-block', attributes: { type, 'fob-attrs': JSON.stringify(values) }, children: [] };
  }

  private caption(figure: HTMLElement): string {
    const caption = figure.querySelector('figcaption');
    return caption ? collapse(caption.text).trim() : '';
  }

  private figure(figure: HTMLElement): Md[] {
    const classes = figure.classList;
    if (classes.contains('code')) return this.codeBlock(figure);
    if (classes.contains('quote') || classes.contains('block-color-gray')) {
      const quote = figure.querySelector('blockquote');
      // Notion 引用体常为裸文本(无 <p>),用 mixed 把行内片段聚成段落。
      return [{ type: 'blockquote', children: this.mixed((quote ?? figure).childNodes) }];
    }
    if (classes.contains('callout')) return this.callout(figure);
    if (classes.contains('image')) {
      const img = figure.querySelector('img');
      const src = img?.getAttribute('src') ?? figure.querySelector('a')?.getAttribute('href') ?? '';
      if (!src) return this.unmappedFigure(figure, '图片缺少源地址');
      const caption = this.caption(figure);
      return [this.mediaEnvelope('image', { src, alt: img?.getAttribute('alt') ?? '', title: img?.getAttribute('title') ?? '', caption })];
    }
    if (classes.contains('video')) {
      const src = figure.querySelector('video')?.getAttribute('src') ?? figure.querySelector('a')?.getAttribute('href') ?? figure.querySelector('iframe')?.getAttribute('src') ?? '';
      if (!src) return this.unmappedFigure(figure, '视频缺少源地址');
      return [this.mediaEnvelope('video', { src, caption: this.caption(figure) })];
    }
    if (classes.contains('audio')) {
      const src = figure.querySelector('audio')?.getAttribute('src') ?? figure.querySelector('a')?.getAttribute('href') ?? '';
      if (!src) return this.unmappedFigure(figure, '音频缺少源地址');
      return [this.mediaEnvelope('audio', { src, caption: this.caption(figure) })];
    }
    if (classes.contains('file')) {
      const link = figure.querySelector('a');
      const src = link?.getAttribute('href') ?? '';
      if (!src) return this.unmappedFigure(figure, '文件块缺少源地址');
      const name = collapse(link?.text ?? '').trim() || src.split('/').at(-1) || src;
      return [this.mediaEnvelope('file', { src, title: name, caption: this.caption(figure) })];
    }
    if (classes.contains('bookmark')) {
      const link = figure.querySelector('a[href]');
      const url = link?.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(url)) return this.unmappedFigure(figure, '书签缺少可解析 URL');
      const title = figure.querySelector('.bookmark-title')?.text.trim() || collapse(link?.text ?? '').trim() || url;
      return [{ type: 'leafDirective', name: 'embed', attributes: { url, title }, children: [] }];
    }
    if (classes.contains('embed')) {
      const url = figure.querySelector('a')?.getAttribute('href') ?? figure.querySelector('iframe')?.getAttribute('src') ?? '';
      if (!url) return this.unmappedFigure(figure, '嵌入缺少源地址');
      if (!/^https?:\/\//i.test(url)) return this.unmappedFigure(figure, `嵌入目标 ${url} 不是可嵌入的 http(s) 地址`);
      return [{ type: 'leafDirective', name: 'embed', attributes: { url, title: '' }, children: [] }];
    }
    if (classes.contains('equation')) {
      const latex = this.latex(figure);
      if (latex === null) {
        this.warn('complex_equation', '块级公式缺少 LaTeX 注记,已保留渲染文本');
        const paragraph = this.paragraph([{ type: 'text', value: collapse(figure.text).trim() }]);
        return paragraph ? [paragraph] : [];
      }
      return latex ? [{ type: 'math', value: latex }] : [];
    }
    if (classes.contains('table')) {
      const table = figure.querySelector('table');
      return table ? this.tableElement(table) : this.blocks(figure.childNodes);
    }
    if (classes.contains('link-to-page')) {
      const paragraph = this.paragraph(this.inline(figure.querySelectorAll('a').length ? [figure.querySelector('a')!] : figure.childNodes));
      return paragraph ? [paragraph] : [];
    }
    const inner = this.blocks(figure.childNodes);
    if (inner.length) return inner;
    return this.unmappedFigure(figure, `未识别的 figure 变体(${classes.value.join(' ') || '无类名'})`);
  }

  private unmappedFigure(figure: HTMLElement, reason: string): Md[] {
    this.warn('unsupported_element', reason);
    const paragraph = this.paragraph(this.inline(figure.childNodes));
    return paragraph ? [paragraph] : [];
  }

  private callout(figure: HTMLElement): Md[] {
    const emoji = figure.querySelector('.callout-emoji')?.text.trim() || '💡';
    const holder = figure.querySelector('.callout-border') ?? figure;
    const tone = this.colorTone(holder) ?? this.colorTone(figure);
    if (tone && !tone.background) this.warn('colored_block', `提示框颜色 ${tone.color} 无对应 tone,按 neutral 导入`);
    const attributes: Record<string, string> = {};
    if (emoji && emoji !== '💡') attributes.emoji = emoji;
    if (tone?.background && tone.color !== 'neutral') attributes.tone = tone.color;
    const children = holder.childNodes.filter((node) =>
      !(node.nodeType === NodeType.ELEMENT_NODE && (node as HTMLElement).classList.contains('callout-emoji')));
    return [{ type: 'containerDirective', name: 'callout', attributes, children: this.mixed(children) }];
  }

  // ---------- 表格与数据库 ----------

  private rowsOf(table: HTMLElement): HTMLElement[] {
    return table.querySelectorAll('tr');
  }

  private tableElement(table: HTMLElement): Md[] {
    const rows = this.rowsOf(table);
    if (!rows.length) return [];
    const headerCells = this.cells(rows[0]!);
    const body = rows.slice(1).map((row) => this.cells(row));
    return [{
      type: 'table',
      align: headerCells.map(() => null),
      children: [
        { type: 'tableRow', children: headerCells.map((cell) => ({ type: 'tableCell', children: this.inline(cell.childNodes) })) },
        ...body.map((cells) => ({ type: 'tableRow', children: cells.map((cell) => ({ type: 'tableCell', children: this.inline(cell.childNodes) })) })),
      ],
    }];
  }

  private cells(row: HTMLElement): HTMLElement[] {
    return row.childNodes.filter((node): node is HTMLElement =>
      node.nodeType === NodeType.ELEMENT_NODE && ['td', 'th'].includes((node as HTMLElement).tagName.toLowerCase()));
  }

  /** 数据库视图表格 → 结构化列/行;失败返回 null(调用方按内联表格回退)。 */
  databaseFromTable(table: HTMLElement): NotionParsedDatabase | null {
    const rows = this.rowsOf(table);
    if (rows.length < 2) return null;
    const header = this.cells(rows[0]!).map((cell) => collapse(cell.text).trim());
    if (header.length < 2 || header.some((name) => !name)) return null;
    const dataRows = rows.slice(1);
    const linked = dataRows.map((row) => this.cells(row)[0]?.querySelector('a[href]')?.getAttribute('href') ?? null);
    if (!linked.some((href) => href && this.options.linkTargetExists(href))) return null;
    const cellText = dataRows.map((row) => this.cells(row).map((cell) => this.inlineText(cell.childNodes)));
    const titles = dataRows.map((row, index) => this.inlineText(this.cells(row)[0]?.childNodes ?? []) || `行 ${index + 1}`);
    const { columns, values, warnings } = inferNotionColumns(header, cellText, this.source, 'html_p');
    const parsed: NotionParsedRow[] = dataRows.map((row, rowIndex) => {
      const properties: Record<string, string | number | boolean | string[]> = {};
      columns.forEach((column, columnIndex) => {
        const value = values[columnIndex]![rowIndex];
        if (value !== null && value !== '') properties[column.id] = value;
      });
      return { title: titles[rowIndex] ?? '', properties, pageKey: linked[rowIndex] };
    });
    return { columns, rows: parsed, warnings };
  }
}

function inlinePlainText(node: Md): string {
  switch (node.type) {
    case 'text': case 'inlineMath':
      return node.value ?? '';
    case 'break':
      return ' ';
    case 'image':
      return node.alt ?? '';
    default:
      return (node.children ?? []).map(inlinePlainText).join('');
  }
}

function taskItemChecked(item: HTMLElement): boolean {
  const checkbox = item.querySelector('.checkbox');
  if (checkbox) return !(checkbox.classList.contains('checkbox-off') || checkbox.classList.contains('checkbox-unchecked'));
  const input = item.querySelector('input[type="checkbox"]');
  if (input) return input.getAttribute('checked') !== undefined;
  return false;
}

/** 默认把 pre 内容整体当原始文本(内部 <code> 不会成为元素);必须从列表移除 pre 才能读出代码内容。 */
const PARSER_OPTIONS = { blockTextElements: { script: true, noscript: true, style: true } };

/**
 * 解析一个 Notion HTML 页面。数据库页判定:正文除空段外仅一张表格、表头 ≥2 列、
 * 且至少一行标题单元格链接到导出内存在的页面(Notion 数据库视图的行标题即行页面);
 * 不满足时表格按普通表格块进入正文,内容不丢失。
 */
export function parseNotionHtml(html: string, source: string, options: NotionHtmlOptions): NotionParsedPage {
  const converter = new Converter(source, options);
  const root = parse(html, PARSER_OPTIONS);
  const title = root.querySelector('.page-title')?.text.trim() ?? null;
  const content = root.querySelector('.page-body') ?? root.querySelector('article') ?? root.querySelector('body') ?? root;

  const tables = content.querySelectorAll('table');
  if (tables.length === 1 && !significantBlocksExceptTable(content, tables[0]!)) {
    const database = converter.databaseFromTable(tables[0]!);
    if (database) {
      return { pageTitle: title, mdast: { type: 'root', children: [] }, warnings: converter.warnings, database };
    }
  }
  return { pageTitle: title, mdast: { type: 'root', children: converter.blocks(content.childNodes) }, warnings: converter.warnings, database: null };
}

/** node-html-parser 没有 DOM contains;沿 parentNode 判祖先。 */
function isDescendant(node: Node, ancestor: Node): boolean {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (current === ancestor) return true;
  }
  return false;
}

/** 除目标表格外是否还有实质块级内容:空段落以外的任何块都使页面不是纯数据库视图。 */
function significantBlocksExceptTable(content: HTMLElement, table: HTMLElement): boolean {
  for (const paragraph of content.querySelectorAll('p')) {
    if (collapse(paragraph.text).trim() && !isDescendant(paragraph, table)) return true;
  }
  for (const node of content.childNodes) {
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    if (element === table || isDescendant(table, element) || isDescendant(element, table)) continue;
    const tag = element.tagName.toLowerCase();
    if (['div', 'article', 'figure'].includes(tag)) {
      if (significantBlocksExceptTable(element, table)) return true;
    } else if (tag !== 'header' && tag !== 'p') return true;
  }
  return false;
}
