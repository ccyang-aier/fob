import { describe, expect, test } from 'bun:test';
import type { Page, Teamspace } from '@fob/shared/knowledge/contracts';
import {
  arrowExpansion,
  buildNavigationSections,
  flattenNavigationTree,
  pageDisplayTitle,
  recycledRootPages,
  stepNavigationFocus,
  untitledPageLabel,
} from './tree-model';

const teamspace = (id: string, name: string): Teamspace => ({
  id,
  knowledgeBaseId: 'base',
  name,
  defaultAccess: null,
});
const ws = 'e2f7a4c1-0000-4000-8000-6b1f9a2c3d01';

type PageSeed = Partial<Page> & Pick<Page, 'id' | 'parentId' | 'position' | 'title'>;

function page(seed: PageSeed): Page {
  return {
    knowledgeBaseId: ws,
    teamspaceId: seed.teamspaceId ?? tsA,
    kind: seed.kind ?? 'doc',
    databaseId: null,
    icon: seed.icon ?? null,
    cover: null,
    properties: {},
    inheritsPermissions: true,
    path: seed.path ?? seed.id,
    createdBy: '00000000-0000-4000-8000-000000000009',
    createdAt: '2026-09-26T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
    deletedAt: seed.deletedAt ?? null,
    ...seed,
  } as Page;
}

const tsA = 'a0000000-0000-4000-8000-00000000000a';
const tsB = 'b0000000-0000-4000-8000-00000000000b';

describe('buildNavigationSections', () => {
  test('folder icons carry the catalog value and removing the value restores the default glyph', () => {
    const folder = { ...teamspace(tsA, '产品'), icon: 'glyph:flask:#20b9eb' };
    expect(buildNavigationSections([folder], [])[0].icon).toBe(folder.icon);
    expect(buildNavigationSections([{ ...folder, icon: null }], [])[0].icon).toBeNull();
  });
  test('one section per teamspace, sections without pages included', () => {
    const sections = buildNavigationSections([teamspace(tsA, '产品'), teamspace(tsB, '运营')], []);
    expect(sections.map((section) => section.title)).toEqual(['产品', '运营']);
    expect(sections[0].pages).toEqual([]);
    expect(sections[0].pageCount).toBe(0);
  });

  test('roots and children nest by parentId; siblings keep fractional-index order', () => {
    const sections = buildNavigationSections(
      [teamspace(tsA, '产品')],
      [
        page({ id: 'p2', parentId: null, position: '00000c', title: '路线图' }),
        page({ id: 'p1', parentId: null, position: '000006', title: '欢迎' }),
        page({ id: 'p1b', parentId: 'p1', position: '000003', title: '子 B' }),
        page({ id: 'p1a', parentId: 'p1', position: '000001', title: '子 A' }),
      ],
    );
    expect(sections[0].pages.map((node) => node.title)).toEqual(['欢迎', '路线图']);
    expect(sections[0].pages[0].children.map((node) => node.title)).toEqual(['子 A', '子 B']);
    expect(sections[0].pageCount).toBe(4);
  });

  test('recycling hides the page and its whole subtree', () => {
    const sections = buildNavigationSections(
      [teamspace(tsA, '产品')],
      [
        page({ id: 'live', parentId: null, position: '000001', title: '保留' }),
        page({
          id: 'dead',
          parentId: null,
          position: '000002',
          title: '回收',
          deletedAt: '2026-09-26T01:00:00Z',
        }),
        page({ id: 'dead-child', parentId: 'dead', position: '000001', title: '回收的子页' }),
      ],
    );
    expect(sections[0].pages.map((node) => node.id)).toEqual(['live']);
    expect(sections[0].pageCount).toBe(1);
  });

  test('a live page under a vanished parent hides instead of surfacing at the root', () => {
    const sections = buildNavigationSections(
      [teamspace(tsA, '产品')],
      [page({ id: 'orphan', parentId: 'gone', position: '000001', title: '孤儿页' })],
    );
    expect(sections[0].pages).toEqual([]);
    expect(sections[0].pageCount).toBe(0);
  });

  test('pages of other teamspaces never leak into a section', () => {
    const sections = buildNavigationSections(
      [teamspace(tsA, '产品')],
      [
        page({
          id: 'foreign',
          teamspaceId: tsB,
          parentId: null,
          position: '000001',
          title: '别家的',
        }),
      ],
    );
    expect(sections[0].pageCount).toBe(0);
  });

  test('whitespace-only and empty titles render the untitled label', () => {
    expect(pageDisplayTitle({ title: '' })).toBe(untitledPageLabel());
    expect(pageDisplayTitle({ title: '   ' })).toBe(untitledPageLabel());
    expect(pageDisplayTitle({ title: ' 手册 ' })).toBe('手册');
  });
});

describe('recycledRootPages (U03 recycle bin)', () => {
  test('lists directly recycled pages newest first; nested recycled pages belong to their recycled root', () => {
    const roots = recycledRootPages([
      page({ id: 'live', parentId: null, position: '000001', title: '保留' }),
      page({
        id: 'dead',
        parentId: null,
        position: '000002',
        title: '昨天回收',
        deletedAt: '2026-09-25T00:00:00Z',
      }),
      page({
        id: 'dead-child',
        parentId: 'dead',
        position: '000001',
        title: '其子页',
        deletedAt: '2026-09-26T01:00:00Z',
      }),
      page({
        id: 'newer-dead',
        parentId: null,
        position: '000003',
        title: '今天回收',
        deletedAt: '2026-09-26T02:00:00Z',
      }),
    ]);
    expect(roots.map((row) => row.id)).toEqual(['newer-dead', 'dead']);
    expect(roots.map((row) => row.title)).toEqual(['今天回收', '昨天回收']);
  });

  test('whitespace titles fall back to the untitled label; live pages never appear', () => {
    const roots = recycledRootPages([
      page({
        id: 'titled',
        parentId: null,
        position: '000001',
        title: '  ',
        deletedAt: '2026-09-26T00:00:00Z',
      }),
      page({ id: 'alive', parentId: null, position: '000002', title: '活着' }),
    ]);
    expect(roots.map((row) => row.title)).toEqual([untitledPageLabel()]);
  });
});

describe('flattenNavigationTree', () => {
  const sections = buildNavigationSections(
    [teamspace(tsA, '产品'), teamspace(tsB, '运营')],
    [
      page({ id: 'p1', parentId: null, position: '000001', title: '欢迎' }),
      page({ id: 'p1a', parentId: 'p1', position: '000001', title: '子页' }),
    ],
  );

  test('collapsed by default: section rows only, pages hidden', () => {
    const items = flattenNavigationTree(sections, {});
    expect(items.map((item) => item.key)).toEqual([`section:${tsA}`, `section:${tsB}`]);
    expect(items[0]).toMatchObject({
      title: '产品',
      kind: 'teamspace',
      expandable: true,
      expanded: false,
      depth: 0,
    });
  });

  test('expansion reveals children with depth and per-node expansion state', () => {
    const items = flattenNavigationTree(sections, { [`section:${tsA}`]: true });
    expect(items.map((item) => item.key)).toEqual([`section:${tsA}`, 'page:p1', `section:${tsB}`]);
    expect(items[1]).toMatchObject({ pageId: 'p1', depth: 1, expandable: true, expanded: false });
    const nested = flattenNavigationTree(sections, { [`section:${tsA}`]: true, 'page:p1': true });
    expect(nested.map((item) => item.key)).toEqual([
      `section:${tsA}`,
      'page:p1',
      'page:p1a',
      `section:${tsB}`,
    ]);
    expect(nested[2].depth).toBe(2);
  });
});

describe('stepNavigationFocus', () => {
  const items = flattenNavigationTree(
    buildNavigationSections(
      [teamspace(tsA, '产品')],
      [page({ id: 'p1', parentId: null, position: '000001', title: '欢迎' })],
    ),
    { [`section:${tsA}`]: true },
  );
  const keys = items.map((item) => item.key);

  test('moves forward and backward through the visible rows', () => {
    expect(stepNavigationFocus(items, null, 1)).toBe(keys[0]);
    expect(stepNavigationFocus(items, keys[0], 1)).toBe(keys[1]);
    expect(stepNavigationFocus(items, keys[1], -1)).toBe(keys[0]);
    expect(stepNavigationFocus(items, keys[0], -1)).toBeNull();
    expect(stepNavigationFocus(items, keys[keys.length - 1], 1)).toBeNull();
  });

  test('a focus key outside the list restarts from the stepped end', () => {
    expect(stepNavigationFocus(items, 'page:unknown', 1)).toBe(keys[0]);
    expect(stepNavigationFocus(items, 'page:unknown', -1)).toBe(keys[keys.length - 1]);
    expect(stepNavigationFocus([], null, 1)).toBeNull();
  });
});

describe('arrowExpansion', () => {
  test('expandable rows toggle; leaf rows and no-op directions report null', () => {
    const collapsed = { expandable: true, expanded: false } as const;
    const expandedRow = { expandable: true, expanded: true } as const;
    const leaf = { expandable: false, expanded: false } as const;
    expect(arrowExpansion(collapsed as never, 'right')).toBe('expand');
    expect(arrowExpansion(collapsed as never, 'left')).toBeNull();
    expect(arrowExpansion(expandedRow as never, 'right')).toBeNull();
    expect(arrowExpansion(expandedRow as never, 'left')).toBe('collapse');
    expect(arrowExpansion(leaf as never, 'right')).toBeNull();
    expect(arrowExpansion(leaf as never, 'left')).toBeNull();
  });
});
