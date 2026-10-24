/**
 * The E06 slash menu + clipboard paste assembly point. The editor surface
 * adds both behaviors with one line:
 *
 * ```ts
 * extensions: [...createKnowledgeExtensions(), …, ...createSlashPasteExtensions()]
 * <SlashMenuLayer editor={editor} />
 * ```
 */

export { createSlashPasteExtensions } from './slash-paste';
export type { SlashPasteOptions, SlashMenuPluginState, SlashMenuStorage } from './slash-paste';
export {
  closeSlashMenu,
  handleClipboardPaste,
  runSlashItem,
  setActiveSlashItem,
  slashItemsOfEditor,
  slashMenuPluginKey,
} from './slash-paste';
export { buildSlashItems, filterSlashItems, registerSlashInsert } from './slash-items';
export type { SlashGroup, SlashInsertCommand, SlashItemIcon, SlashMenuItem } from './slash-items';
export { detectPasteKind } from './markdown-detect';
export type { PasteKind } from './markdown-detect';
export { SlashMenuLayer } from './slash-menu';
