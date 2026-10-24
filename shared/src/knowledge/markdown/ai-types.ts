import type { AssetDerived } from '../contracts';

export interface AiMarkdownOptions {
  dialect: 'ai';
  /** Keys are canonical asset SHA-256 hashes, never model-supplied block IDs. */
  derivedByAsset?: ReadonlyMap<string, AssetDerived>;
}

export type MarkdownExportOptions = { dialect?: 'standard' } | AiMarkdownOptions;
export type MarkdownImportOptions = { dialect?: 'standard' } | { dialect: 'ai'; context: AiMarkdownContext };

/** UTF-16 offsets, matching ProseMirror/remark/JavaScript string coordinates. */
export interface MarkdownRange { readonly from: number; readonly to: number }

export interface AiBlockBinding {
  readonly blockId: string;
  readonly type: string;
  readonly parentBlockId: string | null;
  readonly path: readonly number[];
  /** Exact source node extent in the authoritative PM document. */
  readonly pmRange: MarkdownRange;
  /** Contextual source carrier; nested list/table carriers can overlap. */
  readonly markdownRange: MarkdownRange;
  /** Source carrier plus its attached read-only derivation, if any. */
  readonly contextRange: MarkdownRange;
  /** Exact extent of this block's single {#b:id} token. */
  readonly anchorRange: MarkdownRange;
  readonly derivedRanges: readonly MarkdownRange[];
}

export interface AiBlockRead {
  readonly binding: AiBlockBinding;
  /** Includes structural context/anchors, not an executable editor replacement. */
  readonly markdown: string;
  readonly source: 'authoritative-snapshot';
  readonly readOnly: true;
}

/** Created only from a validated PM document. A lookalike JSON object is not trusted. */
export interface AiMarkdownContext {
  readonly markdown: string;
  readonly blocks: readonly AiBlockBinding[];
  /** C01 read_page.range semantics: selected IDs, returned in document order. */
  read(range?: readonly string[]): readonly AiBlockRead[];
}

export const AI_DERIVED_DIRECTIVE = 'fob-derived';
export const AI_BINDINGS_DATA = 'fobAiBindings';
