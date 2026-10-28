import { findEmoji } from '@/components/icons/emoji-catalog';

type HtmlNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
};

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Keep Markdown storage portable; only decorate the reviewed emoji subset when reading. */
export function commentEmojiPlugin() {
  return (tree: HtmlNode) => {
    const visit = (node: HtmlNode) => {
      if (!node.children || node.tagName === 'code' || node.tagName === 'pre') return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value) {
          visit(child);
          return [child];
        }
        const parts: HtmlNode[] = [];
        let text = '';
        for (const { segment } of graphemes.segment(child.value)) {
          if (!findEmoji(segment)) {
            text += segment;
            continue;
          }
          if (text) parts.push({ type: 'text', value: text });
          text = '';
          parts.push({
            type: 'element', tagName: 'span',
            properties: { dataCommentEmoji: segment },
            children: [{ type: 'text', value: segment }],
          });
        }
        if (text) parts.push({ type: 'text', value: text });
        return parts;
      });
    };
    visit(tree);
  };
}
