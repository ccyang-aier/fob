import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './move-controller.messages';

/**
 * Move controller of the page tree (U03) — pure placement math, no React.
 *
 * Three concerns, all mirroring the T01 backend semantics exactly:
 *
 * 1. **Fractional ordering mirror**: `positionBetween` is a line-for-line
 *    mirror of the backend's deterministic midpoint algorithm (6-digit base-36
 *    integer part, trailing-zero-free fraction, BigInt-exact midpoint). The
 *    shared contract forbids the client from *sending* positions — every
 *    placement request travels as `afterPageId` — so the mirror exists only to
 *    render the optimistic local order before the server's authoritative
 *    `position` settles.
 * 2. **Drop targets**: pointer-over-row zones resolve to a placement
 *    `{ parentId, afterPageId }`, with structural validation (self, own
 *    descendant, cross-teamspace) and one honest contract gap: the position
 *    *before a first child* is not expressible through `afterPageId`
 *    (`null` means "append as last"), so it is rejected as `first-position`
 *    instead of silently landing elsewhere.
 * 3. **Keyboard moves**: Alt+Arrow placements reuse the same validation.
 */

import type { Page } from '@fob/shared/knowledge/contracts';

const knowledgeT = createTranslator(knowledgeMessages);

// ── Fractional index mirror (T01 ordering.ts) ──────────────────────────

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = BigInt(36);
const INTEGER_DIGITS = 6;
const MAX_LENGTH = 256;
const RANGE = BASE ** BigInt(INTEGER_DIGITS);

const canonical = /^[0-9a-z]{6}(?:[0-9a-z]*[1-9a-z])?$/;

/** The optimistic mirror's only failure mode: the sibling keys have no room left. */
export class PositionSpaceExhausted extends RangeError {
  constructor() {
    super('Sibling position space is exhausted');
    this.name = 'PositionSpaceExhausted';
  }
}

/** Code-unit comparison, deliberately not localeCompare — mirrors T01. */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Scaled {
  num: bigint;
  scale: number;
}

function parse(position: string): Scaled {
  if (position.length < INTEGER_DIGITS || position.length > MAX_LENGTH || !canonical.test(position))
    throw new PositionSpaceExhausted();
  let num = BigInt(0);
  for (const char of position) num = num * BASE + BigInt(ALPHABET.indexOf(char));
  return { num, scale: position.length - INTEGER_DIGITS };
}

function format(num: bigint, scale: number): string {
  const divisor = BASE ** BigInt(scale);
  const integer = num / divisor;
  const fraction = (num % divisor).toString(36).padStart(scale, '0').replace(/0+$/, '');
  const position = integer.toString(36).padStart(INTEGER_DIGITS, '0') + fraction;
  if (integer >= RANGE || position.length > MAX_LENGTH) throw new PositionSpaceExhausted();
  return position;
}

/** Strictly between `prev` (null = 0) and `next` (null = 36^6); both null = the range midpoint. */
export function positionBetween(prev: string | null, next: string | null): string {
  const lower = prev === null ? ({ num: BigInt(0), scale: 0 } satisfies Scaled) : parse(prev);
  const upper = next === null ? ({ num: RANGE, scale: 0 } satisfies Scaled) : parse(next);
  const scale = Math.max(lower.scale, upper.scale);
  const left = lower.num * BASE ** BigInt(scale - lower.scale);
  const right = upper.num * BASE ** BigInt(scale - upper.scale);
  if (left >= right) throw new PositionSpaceExhausted();
  const sum = left + right;
  const two = BigInt(2);
  return sum % two === BigInt(0) ? format(sum / two, scale) : format((sum * BASE) / two, scale + 1);
}

// ── Sibling resolution (T01 allocatePosition semantics) ────────────────

/** Live siblings under one parent in fractional order, excluding the moving page itself. */
export function liveSiblingsUnder(
  pages: readonly Page[],
  teamspaceId: string,
  parentId: string | null,
  excludingPageId?: string,
): { id: string; position: string }[] {
  const siblings = pages
    .filter(
      (page) =>
        page.deletedAt === null &&
        page.teamspaceId === teamspaceId &&
        page.parentId === parentId &&
        page.id !== excludingPageId,
    )
    .map((page) => ({ id: page.id, position: page.position }));
  siblings.sort((a, b) =>
    a.position === b.position ? (a.id < b.id ? -1 : 1) : comparePositions(a.position, b.position),
  );
  return siblings;
}

export type InsertAnchor = { afterPageId: string | null };

/**
 * The optimistic position for a placement, mirroring the backend's
 * `allocatePosition`: `afterPageId === null` anchors at the end of the
 * sibling list; an anchor that is not in the list is invalid input.
 */
export function optimisticInsertPosition(
  siblings: readonly { id: string; position: string }[],
  afterPageId: string | null,
): string {
  const anchor =
    afterPageId === null
      ? siblings.length - 1
      : siblings.findIndex((row) => row.id === afterPageId);
  if (afterPageId !== null && anchor < 0)
    throw new RangeError(knowledgeT('afterpageidIsNotAChildOfTheTarget'));
  return positionBetween(
    siblings[anchor]?.position ?? null,
    siblings[anchor + 1]?.position ?? null,
  );
}

// ── Drop targets ────────────────────────────────────────────────────────

export type DropMode = 'before' | 'after' | 'inside';

/**
 * Pointer zone of one row: expandable rows keep a middle "inside" band
 * (top/bottom 25%), leaf rows split in half.
 */
export function dropModeForRow(expandable: boolean, ratioWithinRow: number): DropMode {
  if (expandable) {
    if (ratioWithinRow < 0.25) return 'before';
    if (ratioWithinRow > 0.75) return 'after';
    return 'inside';
  }
  return ratioWithinRow < 0.5 ? 'before' : 'after';
}

export type DropTarget = { pageId: string; mode: DropMode };

export type PlacementRequest = { parentId: string | null; afterPageId: string | null };

export type DropRejection = 'self' | 'descendant' | 'cross-teamspace' | 'first-position';

export type DropResolution =
  { ok: true; placement: PlacementRequest } | { ok: false; reason: DropRejection };

/** All live ids of the subtree rooted at `rootId` (inclusive). */
export function subtreeIdsOf(pages: readonly Page[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const page of pages) {
    if (page.parentId === null) continue;
    const list = childrenOf.get(page.parentId) ?? [];
    list.push(page.id);
    childrenOf.set(page.parentId, list);
  }
  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return ids;
}

/** Resolves a hover target into the expressible placement, validating the tree structure first. */
export function resolveDropPlacement(
  pages: readonly Page[],
  dragPageId: string,
  target: DropTarget,
): DropResolution {
  const dragPage = pages.find((page) => page.id === dragPageId);
  const targetPage = pages.find((page) => page.id === target.pageId);
  if (!dragPage || !targetPage || dragPage.deletedAt !== null || targetPage.deletedAt !== null)
    return { ok: false, reason: 'self' };
  if (target.mode === 'inside') {
    if (target.pageId === dragPageId) return { ok: false, reason: 'self' };
    if (dragPage.teamspaceId !== targetPage.teamspaceId)
      return { ok: false, reason: 'cross-teamspace' };
    if (subtreeIdsOf(pages, dragPageId).has(target.pageId))
      return { ok: false, reason: 'descendant' };
    return { ok: true, placement: { parentId: target.pageId, afterPageId: null } };
  }
  const parentId = targetPage.parentId;
  if (targetPage.teamspaceId !== dragPage.teamspaceId)
    return { ok: false, reason: 'cross-teamspace' };
  if (parentId !== null) {
    if (parentId === dragPageId || subtreeIdsOf(pages, dragPageId).has(parentId))
      return { ok: false, reason: 'descendant' };
  }
  if (target.mode === 'after')
    return { ok: true, placement: { parentId, afterPageId: target.pageId } };
  // 'before' X: anchor on the sibling preceding X (the dragged page itself is
  // not a valid anchor, mirroring the backend's exclusion of the moving row);
  // a first child has no preceding sibling and `afterPageId: null` would mean
  // "append last", so the position before a first child is honestly rejected.
  const siblings = liveSiblingsUnder(pages, targetPage.teamspaceId, parentId, dragPageId);
  const index = siblings.findIndex((row) => row.id === target.pageId);
  if (index <= 0) return { ok: false, reason: 'first-position' };
  return { ok: true, placement: { parentId, afterPageId: siblings[index - 1]!.id } };
}

// ── Keyboard moves (Alt+Arrow) ─────────────────────────────────────────

export type KeyboardMoveDirection = 'up' | 'down' | 'indent' | 'outdent';

export type KeyboardMoveResolution =
  { ok: true; placement: PlacementRequest } | { ok: false; reason: 'no-op' | 'first-position' };

/**
 * Expresses the four keyboard move intents as the same `{ parentId,
 * afterPageId }` placement the drag path produces. Every boundary case that
 * the contract cannot express resolves to `no-op`/`first-position`, never to a
 * different position than the intent.
 */
export function keyboardMovePlacement(
  pages: readonly Page[],
  pageId: string,
  direction: KeyboardMoveDirection,
): KeyboardMoveResolution {
  const page = pages.find((row) => row.id === pageId);
  if (!page || page.deletedAt !== null) return { ok: false, reason: 'no-op' };
  const siblings = liveSiblingsUnder(pages, page.teamspaceId, page.parentId, undefined);
  const index = siblings.findIndex((row) => row.id === pageId);

  if (direction === 'up') {
    if (index <= 1)
      return index === 0 ? { ok: false, reason: 'no-op' } : { ok: false, reason: 'first-position' };
    return {
      ok: true,
      placement: { parentId: page.parentId, afterPageId: siblings[index - 2]!.id },
    };
  }
  if (direction === 'down') {
    if (index === -1 || index >= siblings.length - 1) return { ok: false, reason: 'no-op' };
    return {
      ok: true,
      placement: { parentId: page.parentId, afterPageId: siblings[index + 1]!.id },
    };
  }
  if (direction === 'indent') {
    if (index <= 0) return { ok: false, reason: 'no-op' };
    return { ok: true, placement: { parentId: siblings[index - 1]!.id, afterPageId: null } };
  }
  // outdent
  if (page.parentId === null) return { ok: false, reason: 'no-op' };
  const parent = pages.find((row) => row.id === page.parentId);
  if (!parent) return { ok: false, reason: 'no-op' };
  return { ok: true, placement: { parentId: parent.parentId, afterPageId: parent.id } };
}
