import type { Node } from 'mdast';
import type { Construct, State } from 'micromark-util-types';
import type { Data, Plugin } from 'unified';

export interface WikiLinkNode extends Node {
  type: 'wikiLink';
  target: string;
  label: string | null;
  targetBlockId: string | null;
  embed?: boolean;
}

declare module 'mdast' {
  interface PhrasingContentMap { wikiLink: WikiLinkNode }
  interface RootContentMap { wikiLink: WikiLinkNode }
}
declare module 'micromark-util-types' { interface TokenTypeMap { fobWikiLink: 'fobWikiLink' } }

function fields(value: string): Pick<WikiLinkNode, 'target' | 'label' | 'targetBlockId'> {
  let target = '';
  let label: string | null = null;
  for (let index = 0; index < value.length; index++) {
    let char = value[index];
    if (char === '\\' && /[\\|\[\]]/.test(value[index + 1] ?? '')) char = value[++index];
    else if (char === '|' && label === null) { label = ''; continue; }
    if (label === null) target += char;
    else label += char;
  }
  const block = target.lastIndexOf('#^');
  return block >= 0 ? { target: target.slice(0, block), targetBlockId: target.slice(block + 2), label }
    : { target, label, targetBlockId: null };
}

const wiki: Construct = {
  name: 'fobWikiLink',
  tokenize(effects, ok, nok) {
    let escaped = false;
    let size = 0;
    const start: State = (code) => {
      if (code !== 91 && code !== 33) return nok(code);
      effects.enter('fobWikiLink'); effects.consume(code);
      return code === 33 ? first : second;
    };
    const first: State = (code) => { if (code !== 91) return nok(code); effects.consume(code); return second; };
    const second: State = (code) => {
      if (code !== 91) return nok(code);
      effects.consume(code); return body;
    };
    const body: State = (code) => {
      if (code === null || code < 0) return nok(code);
      if (!escaped && code === 93) { effects.consume(code); return close; }
      escaped = !escaped && code === 92;
      size++; effects.consume(code); return body;
    };
    const close: State = (code) => {
      if (code !== 93 || size === 0) return nok(code);
      effects.consume(code); effects.exit('fobWikiLink'); return ok;
    };
    return start;
  },
};

const fromMarkdown: NonNullable<Data['fromMarkdownExtensions']>[number] = {
  enter: { fobWikiLink(token) { this.enter({ type: 'wikiLink', target: '', label: null, targetBlockId: null }, token); } },
  exit: {
    fobWikiLink(token) {
      const raw = this.sliceSerialize(token);
      const embed = raw.startsWith('!');
      let content = raw.slice(embed ? 3 : 2, -2);
      // A table layer escapes every pipe before the wiki layer interprets it.
      if (this.data.inTable) content = content.replace(/(\\+)\|/g, (_, slashes: string) => `${'\\'.repeat((slashes.length - 1) / 2)}|`);
      Object.assign(this.stack[this.stack.length - 1], fields(content), { embed });
      this.exit(token);
    },
  },
};

const escapeField = (value: string) => value.replace(/[\\|\[\]]/g, '\\$&');

/** A tokenizer, not a regex over parsed text: escaped literals and code remain text. */
export const remarkKnowledgeWikiLinks: Plugin = function () {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ text: { 33: wiki, 91: wiki } });
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
  (data.toMarkdownExtensions ??= []).push({
    handlers: {
      wikiLink(node, _parent, state) {
        const value = node as WikiLinkNode;
        const target = `${value.target}${value.targetBlockId === null ? '' : `#^${value.targetBlockId}`}`;
        let content = `${escapeField(target)}${value.label === null ? '' : `|${escapeField(value.label)}`}`;
        if (state.stack.includes('tableCell')) content = content.replace(/(\\*)\|/g, (_, slashes: string) => `${'\\'.repeat(slashes.length * 2 + 1)}|`);
        return `${value.embed ? '!' : ''}[[${content}]]`;
      },
    },
    unsafe: [{ character: '[', inConstruct: 'phrasing', after: '\\[' }],
  });
};
