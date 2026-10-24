import { nullableString, stringAttribute } from './attributes';
import type { MarkDefinition } from './types';
import { safeKnowledgeUrl } from './urls';

const formattingMark = (name: string, tag: string, mdastType: string): MarkDefinition => ({
  name, schema: { parseDOM: [{ tag }], toDOM: () => [tag, 0] }, markdown: { fromMd: { type: mdastType } },
});

/** Annotation marks remain legal inside code so comments and AI review cover all text. */
export const KNOWLEDGE_MARKS: readonly MarkDefinition[] = Object.freeze<MarkDefinition[]>([
  formattingMark('bold', 'strong', 'strong'),
  formattingMark('italic', 'em', 'emphasis'),
  formattingMark('strike', 's', 'delete'),
  { name: 'underline', schema: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] }, markdown: { fromMd: { directive: 'underline', kind: 'text' } } },
  {
    name: 'code', schema: { code: true, excludes: 'code', parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
    markdown: { fromMd: { type: 'inlineCode' } },
  },
  {
    name: 'link',
    schema: {
      inclusive: false, attrs: { href: stringAttribute, title: nullableString },
      parseDOM: [{ tag: 'a[href]', getAttrs: (element) => ({ href: element.getAttribute('href'), title: element.getAttribute('title') }) }],
      toDOM: (mark) => ['a', { href: safeKnowledgeUrl(mark.attrs.href, 'link'), title: mark.attrs.title, rel: 'noopener noreferrer' }, 0],
    },
    markdown: { fromMd: { type: 'link' } },
  },
  {
    name: 'highlight', schema: { attrs: { color: nullableString }, parseDOM: [{ tag: 'mark' }], toDOM: (mark) => ['mark', { 'data-color': mark.attrs.color }, 0] },
    markdown: { fromMd: { directive: 'highlight', kind: 'text' } },
  },
  ...(['suggestion_insert', 'suggestion_delete'] as const).map((name): MarkDefinition => ({
    name,
    schema: {
      inclusive: false, excludes: '',
      attrs: { suggestionId: stringAttribute, author: stringAttribute, createdAt: stringAttribute },
      toDOM: (mark) => [name === 'suggestion_insert' ? 'ins' : 'del', { 'data-suggestion-id': mark.attrs.suggestionId, 'data-author': mark.attrs.author }, 0],
    },
    markdown: { fromMd: { directive: name.replace('_', '-'), kind: 'text' } },
  })),
  {
    name: 'comment', schema: { inclusive: false, excludes: '', attrs: { threadId: stringAttribute }, toDOM: (mark) => ['span', { 'data-comment-thread': mark.attrs.threadId }, 0] },
    markdown: { fromMd: { directive: 'comment', kind: 'text' } },
  },
]);
