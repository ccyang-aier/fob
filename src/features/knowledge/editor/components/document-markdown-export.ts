import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './document-markdown-export.messages';

import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { safeKnowledgeUrl } from '@fob/shared/knowledge/schema';

const knowledgeT = createTranslator(knowledgeMessages);

const children = (node: ProseMirrorNode) =>
  Array.from({ length: node.childCount }, (_, index) => node.child(index));
const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const text = (value: string) => value.replace(/\\/g, '\\\\').replace(/[`*_\[\]<>~#$|&]/g, '\\$&');
const destination = (value: unknown) => {
  const url = safeKnowledgeUrl(value, 'link');
  // A single .md file cannot carry knowledgeBase assets or session-local blobs.
  // Preserve their human-readable labels/captions instead of broken private URLs.
  if (url && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) && !/^https?:\/\//i.test(url)) return null;
  return url?.replace(/[\s<>"()]/g, (char) => encodeURIComponent(char)) ?? null;
};
const caption = (node: ProseMirrorNode) =>
  node.attrs.caption ? text(String(node.attrs.caption)) : '';
const label = (node: ProseMirrorNode) =>
  String(
    node.attrs.title ||
      node.attrs.alt ||
      (
        {
          video: knowledgeT('video'),
          audio: knowledgeT('audio'),
          file: knowledgeT('attachment'),
          embed: knowledgeT('embeddedContent'),
        } as Record<string, string>
      )[node.type.name] ||
      knowledgeT('image'),
  );

function codeSpan(value: string) {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const padding = /^`|`$/.test(value) || (/^ | $/.test(value) && /[^ ]/.test(value)) ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
}

function markdownMark(mark: Mark, value: string): string {
  // Punctuation at a delimiter edge next to ordinary text can make Markdown
  // emphasis literal. Native inline tags have no flanking ambiguity.
  const edgePunctuation = /^[\p{P}\p{S}]|[\p{P}\p{S}]$/u.test(value);
  switch (mark.type.name) {
    case 'bold':
      return edgePunctuation ? `<strong>${value}</strong>` : `**${value}**`;
    case 'italic':
      return edgePunctuation ? `<em>${value}</em>` : `*${value}*`;
    case 'strike':
    case 'suggestion_delete':
      return edgePunctuation ? `<del>${value}</del>` : `~~${value}~~`;
    case 'underline':
      return `<u>${value}</u>`;
    case 'highlight':
      return `<mark>${value}</mark>`;
    case 'suggestion_insert':
      return `<ins>${value}</ins>`;
    case 'link': {
      const url = destination(mark.attrs.href);
      const title = mark.attrs.title
        ? ` "${String(mark.attrs.title)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/[\r\n]/g, ' ')}"`
        : '';
      return url ? `[${value}](<${url}>${title})` : value;
    }
    default:
      return value;
  }
}

/** Keep adjacent runs under one mark, so code and nested formatting remain readable. */
function inline(node: ProseMirrorNode): string {
  const frames: Array<{ mark: Mark; raw: boolean; value: string }> = [];
  let result = '';
  const append = (value: string) => {
    if (frames.length) frames[frames.length - 1].value += value;
    else result += value;
  };
  const close = () => {
    const frame = frames.pop()!;
    if (frame.mark.type.name === 'code') {
      append(codeSpan(frame.value));
      return;
    }
    // Delimiters beside whitespace are not emphasis in CommonMark.
    const match = frame.value.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
    append(match[1] + (match[2] ? markdownMark(frame.mark, match[2]) : '') + match[3]);
  };
  for (const child of children(node)) {
    const marks = child.marks.filter((mark) => mark.type.name !== 'comment');
    let shared = 0;
    while (shared < frames.length && shared < marks.length && frames[shared].mark.eq(marks[shared]))
      shared++;
    while (frames.length > shared) close();
    for (const mark of marks.slice(shared))
      frames.push({ mark, raw: mark.type.name === 'code', value: '' });
    if (child.isText) append(frames.some((frame) => frame.raw) ? child.text! : text(child.text!));
    else if (child.type.name === 'hardBreak') append('  \n');
    else if (child.type.name === 'inlineMath') append(`$${String(child.attrs.latex)}$`);
    else if (child.type.name === 'wikiLink')
      append(text(String(child.attrs.label || child.attrs.target || knowledgeT('pageLink'))));
    else append(text(child.textContent));
  }
  while (frames.length) close();
  return result;
}

function htmlInline(node: ProseMirrorNode): string {
  return children(node)
    .map((child) => {
      let value = child.isText
        ? html(child.text!)
        : child.type.name === 'hardBreak'
          ? '<br>'
          : html(
              child.type.name === 'inlineMath'
                ? `$${child.attrs.latex}$`
                : child.type.name === 'wikiLink'
                  ? String(child.attrs.label || child.attrs.target)
                  : child.textContent,
            );
      for (const mark of [...child.marks].reverse()) {
        const tag = (
          {
            bold: 'strong',
            italic: 'em',
            strike: 'del',
            code: 'code',
            underline: 'u',
            highlight: 'mark',
            suggestion_insert: 'ins',
            suggestion_delete: 'del',
          } as Record<string, string>
        )[mark.type.name];
        if (tag) value = `<${tag}>${value}</${tag}>`;
        else if (mark.type.name === 'link') {
          const url = destination(mark.attrs.href);
          if (url) value = `<a href="${html(url)}">${value}</a>`;
        }
      }
      return value;
    })
    .join('');
}

/** Native HTML is part of CommonMark; use it only where a pipe table loses structure. */
function htmlBlock(node: ProseMirrorNode): string {
  const body = () => children(node).map(htmlBlock).join('');
  switch (node.type.name) {
    case 'paragraph':
      return `<p>${htmlInline(node)}</p>`;
    case 'heading':
      return `<h${node.attrs.level}>${htmlInline(node)}</h${node.attrs.level}>`;
    case 'bulletList':
      return `<ul>${body()}</ul>`;
    case 'orderedList':
      return `<ol start="${node.attrs.start}">${body()}</ol>`;
    case 'taskList':
      return `<${node.attrs.ordered ? 'ol' : 'ul'}>${body()}</${node.attrs.ordered ? 'ol' : 'ul'}>`;
    case 'listItem':
      return `<li>${body()}</li>`;
    case 'taskItem':
      return `<li>${node.attrs.checked ? '☑' : '☐'} ${body()}</li>`;
    case 'blockquote':
      return `<blockquote>${body()}</blockquote>`;
    case 'callout':
      return `<blockquote><p>${html(String(node.attrs.emoji || '💡'))}</p>${body()}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${html(node.textContent)}</code></pre>`;
    case 'math':
      return `<p>${html(`$$${node.attrs.latex}$$`)}</p>`;
    case 'horizontalRule':
      return '<hr>';
    case 'table':
      return `<table><tbody>${body()}</tbody></table>`;
    case 'tableRow':
      return `<tr>${body()}</tr>`;
    case 'tableHeader':
    case 'tableCell': {
      const tag = node.type.name === 'tableHeader' ? 'th' : 'td';
      const attrs = `${node.attrs.colspan > 1 ? ` colspan="${node.attrs.colspan}"` : ''}${node.attrs.rowspan > 1 ? ` rowspan="${node.attrs.rowspan}"` : ''}${node.attrs.align ? ` align="${html(String(node.attrs.align))}"` : ''}`;
      return `<${tag}${attrs}>${body()}</${tag}>`;
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'embed': {
      const url = destination(node.attrs.src ?? node.attrs.url);
      const content = url
        ? node.type.name === 'image'
          ? `<img src="${html(url)}" alt="${html(String(node.attrs.alt || label(node)))}">`
          : `<a href="${html(url)}">${html(label(node))}</a>`
        : html(label(node));
      return `<figure>${content}${node.attrs.caption ? `<figcaption>${html(String(node.attrs.caption))}</figcaption>` : ''}</figure>`;
    }
    case 'pageLink':
      return `<p>${html(String(node.attrs.title || knowledgeT('pageLink')))}</p>`;
    case 'blockReference':
      return knowledgeT('pBlockReferenceP');
    case 'databaseView':
      return knowledgeT('pDatabaseViewP');
    default:
      return node.childCount ? body() : `<p>${html(node.textContent)}</p>`;
  }
}

function table(node: ProseMirrorNode): string {
  const rows = children(node);
  const cells = rows.map(children);
  const width = cells[0]?.length ?? 0;
  const simple =
    width > 0 &&
    cells.every(
      (row) =>
        row.length === width &&
        row.every(
          (cell) =>
            cell.attrs.colspan === 1 &&
            cell.attrs.rowspan === 1 &&
            cell.childCount === 1 &&
            cell.firstChild?.type.name === 'paragraph' &&
            !children(cell.firstChild).some((child) => child.type.name === 'hardBreak'),
        ),
    ) &&
    cells[0].every((cell) => cell.type.name === 'tableHeader') &&
    cells.slice(1).every((row) => row.every((cell) => cell.type.name === 'tableCell'));
  if (!simple) return htmlBlock(node);
  const line = (row: ProseMirrorNode[]) =>
    `| ${row
      .map((cell) =>
        inline(cell.firstChild!)
          .replace(/\n/g, '<br>')
          .replace(/(\\*)\|/g, (match, slashes: string) =>
            slashes.length % 2 ? match : `${slashes}\\|`,
          ),
      )
      .join(' | ')} |`;
  const separator = `| ${cells[0].map((cell) => (cell.attrs.align === 'center' ? ':---:' : cell.attrs.align === 'right' ? '---:' : cell.attrs.align === 'left' ? ':---' : '---')).join(' | ')} |`;
  return [line(cells[0]), separator, ...cells.slice(1).map(line)].join('\n');
}

function blocks(node: ProseMirrorNode): string {
  return children(node).map(block).filter(Boolean).join('\n\n');
}

function block(node: ProseMirrorNode): string {
  switch (node.type.name) {
    case 'paragraph':
      return inline(node)
        .replace(/^(\d+)([.)])(?=\s)/, '$1\\$2')
        .replace(/^([-+])(?=\s)/, '\\$1');
    case 'heading':
      return `${'#'.repeat(node.attrs.level)} ${inline(node)}`;
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const ordered = node.type.name === 'orderedList' || node.attrs.ordered;
      return children(node)
        .map((item, index) => {
          const marker = ordered ? `${(node.attrs.start ?? 1) + index}. ` : '- ';
          const check = item.type.name === 'taskItem' ? (item.attrs.checked ? '[x] ' : '[ ] ') : '';
          const lines = blocks(item).split('\n');
          return (
            marker +
            check +
            lines[0] +
            lines
              .slice(1)
              .map((line) => `\n${line ? ' '.repeat(marker.length) + line : ''}`)
              .join('')
          );
        })
        .join('\n');
    }
    case 'blockquote':
      return blocks(node)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'callout':
      return `${String(node.attrs.emoji || '💡')}\n\n${blocks(node)}`
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'codeBlock': {
      const fence = '`'.repeat(
        Math.max(
          3,
          ...Array.from(node.textContent.matchAll(/`+/g), (match) => match[0].length + 1),
        ),
      );
      const language = String(node.attrs.language || '')
        .trim()
        .split(/\s/, 1)[0]
        .replace(/[^\w#+.-]/g, '');
      return `${fence}${language}\n${node.textContent}\n${fence}`;
    }
    case 'math':
      return `$$\n${node.attrs.latex}\n$$`;
    case 'horizontalRule':
      return '---';
    case 'table':
      return table(node);
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'embed': {
      const url = destination(node.attrs.src ?? node.attrs.url);
      const name = text(
        node.type.name === 'image' ? String(node.attrs.alt || node.attrs.title || '') : label(node),
      );
      const content = url
        ? `${node.type.name === 'image' ? '!' : ''}[${name}](<${url}>)`
        : name || knowledgeT('image');
      return [content, caption(node)].filter(Boolean).join('\n\n');
    }
    case 'pageLink':
      return text(String(node.attrs.title || knowledgeT('pageLink')));
    case 'blockReference':
      return knowledgeT('blockReference');
    case 'databaseView':
      return knowledgeT('databaseView');
    // Columns and AI containers flatten into their readable child blocks in order.
    default:
      return node.childCount ? blocks(node) : text(node.textContent);
  }
}

/** Public GFM export deliberately omits Fob identity and round-trip directives. */
export function exportDocumentMarkdown(document: ProseMirrorNode, title: string): string {
  return `# ${text(title.trim() || knowledgeT('untitledDocument'))}\n\n${blocks(document)}\n`;
}
