/** All ranges are absolute, half-open ProseMirror positions (UTF-16 text offsets). */
export interface HistoryRange { readonly from: number; readonly to: number }
export interface HistoryBlockLocation {
  readonly type: string;
  readonly parentBlockId: string | null;
  readonly index: number;
  readonly path: readonly number[];
  readonly range: HistoryRange;
}
export type HistoryChangeReason = 'added' | 'removed' | 'moved' | 'type' | 'attributes' | 'marks' | 'inline';
export interface HistoryInlineChange { readonly before: HistoryRange; readonly after: HistoryRange }
export interface HistoryInlineDiff {
  /** Coarse means the exact changed span is shown, without claiming a minimal edit script. */
  readonly precision: 'grapheme' | 'coarse';
  readonly changes: readonly HistoryInlineChange[];
}
export interface HistoryBlockChange {
  readonly blockId: string;
  readonly before: HistoryBlockLocation | null;
  readonly after: HistoryBlockLocation | null;
  readonly reasons: readonly HistoryChangeReason[];
  /** Names of changed attributes; values remain in the caller-owned snapshots. */
  readonly attributes: readonly string[];
  readonly inline: HistoryInlineDiff | null;
}
export interface HistoryDiffOptions {
  /** Shared across the entire comparison, not multiplied by the number of blocks. */
  readonly maxInlineComparisonCells?: number;
}
export class HistoryDiffError extends Error {
  constructor(readonly code: 'invalid_document' | 'invalid_block_identity' | 'schema_mismatch' | 'invalid_options') {
    super(`History comparison failed (${code}).`);
    this.name = 'HistoryDiffError';
  }
}
