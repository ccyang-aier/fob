import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './highlight.messages';
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

export function CODE_LANGUAGES(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    { value: 'auto', label: knowledgeT('autoDetect') },
    { value: 'plaintext', label: knowledgeT('plainText') },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'python', label: 'Python' },
    { value: 'json', label: knowledgeT('json') },
    { value: 'sql', label: 'SQL' },
    { value: 'bash', label: 'Shell' },
    { value: 'css', label: 'CSS' },
    { value: 'xml', label: 'HTML / XML' },
    { value: 'rust', label: 'Rust' },
    { value: 'go', label: 'Go' },
    { value: 'markdown', label: 'Markdown' },
  ] as const;
}

for (const [name, language] of Object.entries({
  bash,
  css,
  go,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
})) {
  hljs.registerLanguage(name, language);
}

const languageNames = CODE_LANGUAGES()
  .filter(({ value }) => value !== 'auto' && value !== 'plaintext')
  .map(({ value }) => value);
const highlightKey = new PluginKey<DecorationSet>('fobCodeHighlight');
const tokenCache = new WeakMap<
  ProseMirrorNode,
  readonly { from: number; to: number; className: string }[]
>();

export function detectedCodeLanguage(value: string): string | null {
  if (value.trim().length < 12) return null;
  return hljs.highlightAuto(value.slice(0, 8000), languageNames).language ?? null;
}

function codeTokens(node: ProseMirrorNode) {
  const cached = tokenCache.get(node);
  if (cached) return cached;
  const tokens: { from: number; to: number; className: string }[] = [];
  if (node.type.name !== 'codeBlock' || !node.textContent || node.textContent.length > 30000) {
    tokenCache.set(node, tokens);
    return tokens;
  }
  const language = node.attrs.language || detectedCodeLanguage(node.textContent);
  if (!language || language === 'plaintext' || !hljs.getLanguage(language)) {
    tokenCache.set(node, tokens);
    return tokens;
  }
  const html = hljs.highlight(node.textContent, { language, ignoreIllegals: true }).value;
  const container = document.createElement('div');
  container.innerHTML = html;
  let offset = 0;
  const visit = (element: Node, classes: string[]) => {
    if (element.nodeType === Node.TEXT_NODE) {
      const length = element.textContent?.length ?? 0;
      if (length && classes.length)
        tokens.push({ from: offset, to: offset + length, className: classes.join(' ') });
      offset += length;
      return;
    }
    const next =
      element instanceof Element ? [...classes, ...Array.from(element.classList)] : classes;
    element.childNodes.forEach((child) => visit(child, next));
  };
  container.childNodes.forEach((child) => visit(child, []));
  tokenCache.set(node, tokens);
  return tokens;
}

function codeDecorations(doc: ProseMirrorNode): DecorationSet {
  const spans: Decoration[] = [];
  if (typeof document === 'undefined') return DecorationSet.empty;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    for (const token of codeTokens(node))
      spans.push(
        Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: token.className }),
      );
  });
  return DecorationSet.create(doc, spans);
}

export const CodeHighlight = Extension.create({
  name: 'fobCodeHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: highlightKey,
        state: {
          init: (_, state) => codeDecorations(state.doc),
          apply: (transaction, decorations) =>
            transaction.docChanged ? codeDecorations(transaction.doc) : decorations,
        },
        props: { decorations: (state) => highlightKey.getState(state) ?? DecorationSet.empty },
      }),
    ];
  },
});
