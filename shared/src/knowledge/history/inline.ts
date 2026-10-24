import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { HistoryInlineChange, HistoryInlineDiff } from './types';

interface Token { node: ProseMirrorNode; text: string | null; from: number }
interface InlineContent { tokens: Token[]; end: number }
export interface ComparisonBudget { cells: number }
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

function tokenize(block: ProseMirrorNode, position: number): InlineContent {
  const start = position + (block.isLeaf ? 0 : 1);
  const result: InlineContent = { tokens: [], end: start };
  if (!block.inlineContent) return result;
  result.end += block.content.size;
  block.forEach((node, offset) => {
    if (node.isText) {
      for (const item of segmenter.segment(node.text!)) result.tokens.push({ node, text: item.segment, from: start + offset + item.index });
    } else result.tokens.push({ node, text: null, from: start + offset });
  });
  return result;
}

function equal(left: Token, right: Token): boolean {
  return left.text === right.text && (left.text === null ? left.node.eq(right.node) : left.node.sameMarkup(right.node));
}
const boundary = (content: InlineContent, index: number) => content.tokens[index]?.from ?? content.end;

/** Inline atoms are indivisible; marks/annotation attributes participate in equality. */
export function compareInline(beforeNode: ProseMirrorNode, beforePosition: number, afterNode: ProseMirrorNode, afterPosition: number, budget: ComparisonBudget): HistoryInlineDiff {
  const before = tokenize(beforeNode, beforePosition), after = tokenize(afterNode, afterPosition);
  const left = before.tokens, right = after.tokens;
  let prefix = 0, leftEnd = left.length, rightEnd = right.length;
  while (prefix < leftEnd && prefix < rightEnd && equal(left[prefix], right[prefix])) prefix++;
  while (leftEnd > prefix && rightEnd > prefix && equal(left[leftEnd - 1], right[rightEnd - 1])) { leftEnd--; rightEnd--; }
  const changes: HistoryInlineChange[] = [];
  function append(leftStart: number, leftStop: number, rightStart: number, rightStop: number) {
    if (leftStart === leftStop && rightStart === rightStop) return;
    changes.push({ before: { from: boundary(before, leftStart), to: boundary(before, leftStop) },
      after: { from: boundary(after, rightStart), to: boundary(after, rightStop) } });
  }
  const rows = leftEnd - prefix, columns = rightEnd - prefix;
  if (!rows || !columns) {
    append(prefix, leftEnd, prefix, rightEnd);
    return { precision: 'grapheme', changes };
  }
  const cells = (rows + 1) * (columns + 1);
  if (cells > budget.cells) {
    append(prefix, leftEnd, prefix, rightEnd);
    return { precision: 'coarse', changes };
  }
  budget.cells -= cells;
  const stride = columns + 1, matrix = new Uint32Array(cells);
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      matrix[row * stride + column] = equal(left[prefix + row], right[prefix + column])
        ? matrix[(row + 1) * stride + column + 1] + 1
        : Math.max(matrix[(row + 1) * stride + column], matrix[row * stride + column + 1]);
    }
  }
  let row = 0, column = 0, leftStart = prefix, rightStart = prefix;
  while (row < rows && column < columns) {
    if (equal(left[prefix + row], right[prefix + column])) {
      append(leftStart, prefix + row, rightStart, prefix + column);
      row++; column++;
      leftStart = prefix + row; rightStart = prefix + column;
    } else if (matrix[(row + 1) * stride + column] >= matrix[row * stride + column + 1]) row++;
    else column++;
  }
  append(leftStart, leftEnd, rightStart, rightEnd);
  return { precision: 'grapheme', changes };
}
