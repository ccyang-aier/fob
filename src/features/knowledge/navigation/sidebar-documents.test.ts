import { expect, test } from 'bun:test';
import type { Page, Teamspace } from '@fob/shared/knowledge/contracts';
import { buildNavigationSections } from './tree-model';
import { sidebarDocuments } from './sidebar-documents';

test('collections share the reachable page tree and order recent pages by update time', () => {
  const base = { id: 'base', knowledgeBaseId: 'server', name: '知识库', defaultAccess: 'edit' } as Teamspace;
  const page = (id: string, parentId: string | null, updatedAt: string, deletedAt: string | null = null) => ({ id, teamspaceId: base.id, parentId, title: id, kind: 'doc', icon: null, position: 'a0', updatedAt, deletedAt }) as Page;
  const pages = [
    page('root', null, '2026-09-27T00:00:00Z'),
    page('child', 'root', '2026-09-28T00:00:00Z'),
    page('recycled', null, '2026-09-29T00:00:00Z', '2026-09-29T00:00:00Z'),
    page('hidden-child', 'recycled', '2026-09-30T00:00:00Z'),
  ];
  expect(sidebarDocuments(buildNavigationSections([base], pages), pages).map((row) => row.id)).toEqual(['child', 'root']);
});
