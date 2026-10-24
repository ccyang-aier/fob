import type { Node } from 'mdast';
import type { Construct, State } from 'micromark-util-types';
import type { Data, Plugin } from 'unified';

export interface BlockAnchorNode extends Node { type: 'blockAnchor'; blockId: string }

declare module 'mdast' {
  interface PhrasingContentMap { blockAnchor: BlockAnchorNode }
  interface RootContentMap { blockAnchor: BlockAnchorNode }
}
declare module 'micromark-util-types' { interface TokenTypeMap { fobBlockAnchor: 'fobBlockAnchor' } }

const anchor: Construct = {
  name: 'fobBlockAnchor',
  tokenize(effects, ok, nok) {
    const prefix = '{#b:';
    let index = 0;
    const start: State = (code) => {
      if (code !== prefix.charCodeAt(index)) return nok(code);
      if (index === 0) effects.enter('fobBlockAnchor');
      effects.consume(code);
      return ++index === prefix.length ? body : start;
    };
    const body: State = (code) => {
      if (code === null || code < 0 || code === 123) return nok(code);
      effects.consume(code);
      if (code === 125) { effects.exit('fobBlockAnchor'); return ok; }
      return body;
    };
    return start;
  },
};

const fromMarkdown: NonNullable<Data['fromMarkdownExtensions']>[number] = {
  enter: { fobBlockAnchor(token) { this.enter({ type: 'blockAnchor', blockId: '' }, token); } },
  exit: {
    fobBlockAnchor(token) {
      (this.stack[this.stack.length - 1] as BlockAnchorNode).blockId = this.sliceSerialize(token).slice(4, -1);
      this.exit(token);
    },
  },
};

/** Installed only on the AI branch of the shared processor. Literal text escapes. */
export const remarkKnowledgeBlockAnchors: Plugin = function () {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ text: { 123: anchor } });
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
  (data.toMarkdownExtensions ??= []).push({
    handlers: { blockAnchor(node) { return ` {#b:${(node as BlockAnchorNode).blockId}}`; } },
    unsafe: [{ character: '{', inConstruct: 'phrasing', after: '#b:' }],
  });
};
