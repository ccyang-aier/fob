import { describe, expect, test } from 'bun:test';
import type { Page } from '@fob/shared/knowledge/contracts';
import {
  dropModeForRow,
  keyboardMovePlacement,
  liveSiblingsUnder,
  optimisticInsertPosition,
  positionBetween,
  PositionSpaceExhausted,
  resolveDropPlacement,
  subtreeIdsOf,
} from './move-controller';

const ws = 'e2f7a4c1-0000-4000-8000-6b1f9a2c3d01';
const tsA = 'a0000000-0000-4000-8000-00000000000a';
const tsB = 'b0000000-0000-4000-8000-00000000000b';

type PageSeed = Partial<Page> & Pick<Page, 'id' | 'parentId' | 'position'>;

function page(seed: PageSeed): Page {
  return {
    knowledgeBaseId: ws,
    teamspaceId: seed.teamspaceId ?? tsA,
    kind: 'doc',
    databaseId: null,
    title: seed.title ?? seed.id,
    icon: null,
    cover: null,
    properties: {},
    inheritsPermissions: true,
    path: seed.path ?? seed.id.replaceAll('-', '_'),
    createdBy: '00000000-0000-4000-8000-000000000009',
    createdAt: '2026-09-26T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
    deletedAt: seed.deletedAt ?? null,
    ...seed,
  } as Page;
}

/** Roots r1 < r2 < r3 with children c1 < c2 under r1, one page in another teamspace. */
function sampleTree(): Page[] {
  return [
    page({ id: 'r1', parentId: null, position: '000003' }),
    page({ id: 'r2', parentId: null, position: '000009' }),
    page({ id: 'r3', parentId: null, position: '00000i' }),
    page({ id: 'c1', parentId: 'r1', position: '000003' }),
    page({ id: 'c2', parentId: 'r1', position: '000009' }),
    page({ id: 'other', teamspaceId: tsB, parentId: null, position: '000003' }),
  ];
}

describe('positionBetween (T01 mirror)', () => {
  test('empty range returns the exact midpoint key', () => {
    // (0 + 36^6) / 2 = 18 * 36^5, a pure 6-digit integer key: 18 = 'i' then zeros.
    expect(positionBetween(null, null)).toBe('i00000');
  });

  test('results stay canonical, strictly between the bounds, and code-unit ordered', () => {
    const canonical = /^[0-9a-z]{6}(?:[0-9a-z]*[1-9a-z])?$/;
    const keys = ['00000i', '00000i9', '00000iz', '0000f5', '0000f5a', 'zzzzzz' + 'a'.repeat(200)];
    for (const prev of [null, ...keys]) {
      for (const next of [null, ...keys]) {
        if (prev !== null && next !== null && !(prev < next)) continue;
        const mid = positionBetween(prev, next);
        expect(canonical.test(mid)).toBe(true);
        if (prev !== null) expect(prev < mid).toBe(true);
        if (next !== null) expect(mid < next).toBe(true);
      }
    }
  });

  test('repeated midpoints keep nesting without ever colliding', () => {
    let lower: string | null = null;
    let upper: string | null = null;
    for (let index = 0; index < 40; index += 1) {
      const key = positionBetween(lower, upper);
      if (lower !== null) expect(lower < key).toBe(true);
      if (upper !== null) expect(key < upper).toBe(true);
      if (index % 2 === 0) upper = key; // Shrink from the top…
      else lower = key; // …then from the bottom, alternating.
    }
    expect(upper!.length).toBeLessThanOrEqual(256);
  });

  test('degenerate bounds throw the exhaustion error the caller can branch on', () => {
    const tight = 'a'.repeat(256);
    expect(() => positionBetween(tight, tight)).toThrow(PositionSpaceExhausted);
  });
});

describe('optimisticInsertPosition (allocatePosition mirror)', () => {
  test('a fresh sibling set gets the midpoint; appending anchors at the end', () => {
    expect(optimisticInsertPosition([], null)).toBe('i00000');
    const siblings = [
      { id: 'a', position: '000003' },
      { id: 'b', position: '00000i' },
    ];
    const appended = optimisticInsertPosition(siblings, null);
    expect(appended > '00000i').toBe(true); // Still below the range midpoint 'i00000'.
    const afterFirst = optimisticInsertPosition(siblings, 'a');
    expect(afterFirst > '000003').toBe(true);
    expect(afterFirst < '00000i').toBe(true);
  });

  test('an anchor outside the sibling list is invalid input', () => {
    expect(() => optimisticInsertPosition([{ id: 'a', position: '000003' }], 'missing')).toThrow(RangeError);
  });
});

describe('dropModeForRow', () => {
  test('expandable rows split 25/50/25; leaf rows split in half', () => {
    expect(dropModeForRow(true, 0.1)).toBe('before');
    expect(dropModeForRow(true, 0.5)).toBe('inside');
    expect(dropModeForRow(true, 0.9)).toBe('after');
    expect(dropModeForRow(false, 0.4)).toBe('before');
    expect(dropModeForRow(false, 0.6)).toBe('after');
  });
});

describe('resolveDropPlacement', () => {
  test('inside nests as the last child; after anchors directly on the target', () => {
    const inside = resolveDropPlacement(sampleTree(), 'r2', { pageId: 'r1', mode: 'inside' });
    expect(inside).toEqual({ ok: true, placement: { parentId: 'r1', afterPageId: null } });
    const after = resolveDropPlacement(sampleTree(), 'c2', { pageId: 'c1', mode: 'after' });
    expect(after).toEqual({ ok: true, placement: { parentId: 'r1', afterPageId: 'c1' } });
  });

  test("'before' anchors on the preceding sibling, excluding the dragged page itself", () => {
    const before = resolveDropPlacement(sampleTree(), 'r3', { pageId: 'r2', mode: 'before' });
    expect(before).toEqual({ ok: true, placement: { parentId: null, afterPageId: 'r1' } });
    // Dragging r2 before r3: the preceding sibling of r3 must not be r2 itself.
    const movingSelfAdjacent = resolveDropPlacement(sampleTree(), 'r2', { pageId: 'r3', mode: 'before' });
    expect(movingSelfAdjacent).toEqual({ ok: true, placement: { parentId: null, afterPageId: 'r1' } });
  });

  test('the position before a first child is rejected, never silently re-targeted', () => {
    expect(resolveDropPlacement(sampleTree(), 'r2', { pageId: 'c1', mode: 'before' })).toEqual({ ok: false, reason: 'first-position' });
    expect(resolveDropPlacement(sampleTree(), 'r3', { pageId: 'r1', mode: 'before' })).toEqual({ ok: false, reason: 'first-position' });
  });

  test('self, descendants and cross-teamspace targets are structurally rejected', () => {
    expect(resolveDropPlacement(sampleTree(), 'r1', { pageId: 'r1', mode: 'inside' })).toEqual({ ok: false, reason: 'self' });
    expect(resolveDropPlacement(sampleTree(), 'r1', { pageId: 'c2', mode: 'inside' })).toEqual({ ok: false, reason: 'descendant' });
    expect(resolveDropPlacement(sampleTree(), 'r1', { pageId: 'c1', mode: 'after' })).toEqual({ ok: false, reason: 'descendant' }); // Would nest r1 under itself.
    expect(resolveDropPlacement(sampleTree(), 'r2', { pageId: 'other', mode: 'inside' })).toEqual({ ok: false, reason: 'cross-teamspace' });
    expect(resolveDropPlacement(sampleTree(), 'r2', { pageId: 'other', mode: 'after' })).toEqual({ ok: false, reason: 'cross-teamspace' });
  });
});

describe('keyboardMovePlacement', () => {
  test('up anchors two slots back; down anchors on the next sibling', () => {
    const tree = sampleTree();
    expect(keyboardMovePlacement(tree, 'r3', 'up')).toEqual({ ok: true, placement: { parentId: null, afterPageId: 'r1' } });
    expect(keyboardMovePlacement(tree, 'r1', 'down')).toEqual({ ok: true, placement: { parentId: null, afterPageId: 'r2' } });
    expect(keyboardMovePlacement(tree, 'c1', 'down')).toEqual({ ok: true, placement: { parentId: 'r1', afterPageId: 'c2' } });
  });

  test('indent appends as the last child of the previous sibling; outdent lands right after the parent', () => {
    const tree = sampleTree();
    expect(keyboardMovePlacement(tree, 'r2', 'indent')).toEqual({ ok: true, placement: { parentId: 'r1', afterPageId: null } });
    expect(keyboardMovePlacement(tree, 'c2', 'outdent')).toEqual({ ok: true, placement: { parentId: null, afterPageId: 'r1' } });
  });

  test('contract-inexpressible or vacuous intents are no-ops, never different positions', () => {
    const tree = sampleTree();
    expect(keyboardMovePlacement(tree, 'r1', 'up')).toEqual({ ok: false, reason: 'no-op' }); // Already first.
    expect(keyboardMovePlacement(tree, 'r2', 'up')).toEqual({ ok: false, reason: 'first-position' }); // Second → first is inexpressible.
    expect(keyboardMovePlacement(tree, 'r3', 'up')).toEqual({ ok: true, placement: { parentId: null, afterPageId: 'r1' } }); // Third → second works.
    expect(keyboardMovePlacement(tree, 'r3', 'down')).toEqual({ ok: false, reason: 'no-op' });
    expect(keyboardMovePlacement(tree, 'r1', 'indent')).toEqual({ ok: false, reason: 'no-op' });
    expect(keyboardMovePlacement(tree, 'r1', 'outdent')).toEqual({ ok: false, reason: 'no-op' });
  });
});

describe('liveSiblingsUnder / subtreeIdsOf', () => {
  test('siblings are fractional-ordered, parent-scoped and can exclude the moving page', () => {
    const tree = sampleTree();
    expect(liveSiblingsUnder(tree, tsA, null).map((row) => row.id)).toEqual(['r1', 'r2', 'r3']);
    expect(liveSiblingsUnder(tree, tsA, 'r1').map((row) => row.id)).toEqual(['c1', 'c2']);
    expect(liveSiblingsUnder(tree, tsA, null, 'r2').map((row) => row.id)).toEqual(['r1', 'r3']);
    expect(liveSiblingsUnder(tree, tsB, null).map((row) => row.id)).toEqual(['other']);
  });

  test('the subtree of a node contains itself and every descendant', () => {
    const ids = subtreeIdsOf(sampleTree(), 'r1');
    expect(ids.has('r1')).toBe(true);
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(true);
    expect(ids.has('r2')).toBe(false);
  });
});
