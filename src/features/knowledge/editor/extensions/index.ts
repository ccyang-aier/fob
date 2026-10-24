/**
 * The E04 block editing extension set: Markdown shortcut input rules plus
 * the Notion/GDocs keyboard behaviors, all resolved against the shared E01
 * registry schema. Assembly point (one line in the editor surface):
 *
 * ```ts
 * extensions: [...createKnowledgeExtensions(), ...createBlockEditingExtensions(), …]
 * ```
 */

import type { Extensions } from '@tiptap/core';
import { EDITOR_BLOCK_MODULES } from '../block-modules';
import { MarkInputRules } from './input-rules/mark-input-rules';
import { BlockBackspaceKey } from './keyboard/block-backspace';
import { BlockEnterKey } from './keyboard/block-enter';
import { BlockMoveKey } from './keyboard/block-move';
import { BlockFormatShortcuts } from './keyboard/block-format-shortcuts';
import { DocumentSearch } from './document-search';
import { ListIndentKey } from './keyboard/list-indent';

export { MarkInputRules };
export { BlockBackspaceKey, BlockEnterKey, BlockMoveKey, BlockFormatShortcuts, ListIndentKey };
export { moveBlock } from './keyboard/block-move';
export { currentBlockFormat, insertMathBlock, setBlockFormat } from './format/block-format';
export type { BlockFormat, ListKind } from './format/block-format';
export { nearestAncestor, nearestListItem } from './prose-context';

/** All E04 behaviors as one extension list (input rules, keyboard editing). */
export function createBlockEditingExtensions(): Extensions {
  return [
    ...EDITOR_BLOCK_MODULES.flatMap((module) => module.extensions ?? []),
    DocumentSearch,
    MarkInputRules,
    BlockEnterKey,
    BlockBackspaceKey,
    ListIndentKey,
    BlockMoveKey,
    BlockFormatShortcuts,
  ];
}
