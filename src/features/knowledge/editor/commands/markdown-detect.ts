/**
 * The clipboard Markdown heuristic (E06): decides whether a pasted plain-text
 * payload should take the Markdown pipeline or the editor's default plain
 * paste. Pure string classification — no DOM, no editor — so the heuristic is
 * table-testable on its own.
 *
 * The rule set is deliberately conservative: two or more line-level markers
 * (heading / list / quote), or any fence / GFM table row, is Markdown; a
 * single leading list marker converts too. Strong inline-only markers
 * (`` `code` ``, `**bold**`, `[text](url)`) also count, because pasting them
 * as literal characters is never what the writer intended.
 */

export type PasteKind = 'markdown' | 'plain';

/** Line-start structural markers (CommonMark ATX headings, lists, quotes). */
const LINE_MARKERS: readonly RegExp[] = [
  /^#{1,6}\s/,
  /^(?:[-*+]|\d+\.)\s/,
  /^>\s?/,
];

/** Any occurrence already says “structured Markdown”, not prose. */
const FENCE_MARKER = /^\s*(?:```|~~~)/;
const TABLE_MARKER = /^\s*\|.*\|\s*$/;
const INLINE_MARKERS: readonly RegExp[] = [
  /\*\*[^*\n]+\*\*/,
  /__[^_\n]+__/,
  /`[^`\n]+`/,
  /!?\[[^\]\n]*\]\([^)\n]+\)/,
];

/** Whether a plain-text clipboard payload should be parsed as Markdown. */
export function detectPasteKind(text: string): 'markdown' | 'plain' {
  if (!text) return 'plain';
  const lines = text.split(/\r\n|\r|\n/);
  let lineMarkers = 0;
  for (const line of lines) {
    if (FENCE_MARKER.test(line) || TABLE_MARKER.test(line)) return 'markdown';
    if (LINE_MARKERS.some((pattern) => pattern.test(line))) lineMarkers += 1;
  }
  // A single leading list marker converts on its own; one lone heading or
  // quote line does not (“# ” turns up in chat excerpts pasted as prose).
  if (lineMarkers >= 2 || (lineMarkers >= 1 && /^(?:[-*+]|\d+\.)\s/.test(lines[0]))) return 'markdown';
  if (INLINE_MARKERS.some((pattern) => pattern.test(text))) return 'markdown';
  return 'plain';
}
