import { describe, expect, test } from 'bun:test';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { bindImportedReferenceKnowledgeBase, collectAnchorReferences, collectAssetReferences, createVaultResolver, exportVaultBody, importVaultBody, markdownSchema } from './body';
import type { VaultBodyError } from './body';

/**
 * M03 正文边界单元验收:vault 语义(wiki 链接、嵌入、附件路径)与页面正文
 * 语义(pageId、asset:hash)之间的双向翻译。管线本身(M01)不在重复覆盖。
 */

const HASH_PNG = 'a'.repeat(64);
const HASH_PDF = 'b'.repeat(64);
const HASH_JPG = 'c'.repeat(64);

const resolver = createVaultResolver(
  [
    { path: 'Index', pageId: '11111111-1111-4111-8111-111111111111' },
    { path: 'Projects/roadmap', pageId: '22222222-2222-4222-8222-222222222222' },
    { path: 'Projects/deep/dive', pageId: '33333333-3333-4333-8333-333333333333' },
    { path: 'left/Duplicated', pageId: '44444444-4444-4444-8444-444444444444' },
    { path: 'folder/Duplicated', pageId: '55555555-5555-4555-8555-555555555555' },
  ],
  [
    { path: 'assets/photo.png', hash: HASH_PNG, mime: 'image/png' },
    { path: 'assets/report.pdf', hash: HASH_PDF, mime: 'application/pdf' },
    { path: 'assets/pic.jpg', hash: HASH_JPG, mime: 'image/jpeg' },
  ],
);

const exportContext = (over: Partial<Parameters<typeof exportVaultBody>[1]> = {}) => ({
  knowledgeBaseId: '10000000-0000-4000-8000-000000000001',
  vaultPathOf: (pageId: string) => ({
    '11111111-1111-4111-8111-111111111111': 'Index',
    '22222222-2222-4222-8222-222222222222': 'Projects/roadmap',
    '33333333-3333-4333-8333-333333333333': 'Projects/deep/dive',
  })[pageId],
  attachmentPathOf: (hash: string) => `_attachments/${hash}.${hash === HASH_PDF ? 'pdf' : 'png'}`,
  anchoredBlockIds: new Set<string>(),
  ...over,
});

function walk(node: ProseMirrorNode): { type: string; attrs: Record<string, unknown> }[] {
  const rows = [{ type: node.type.name, attrs: node.attrs as Record<string, unknown> }];
  node.forEach((child) => rows.push(...walk(child)));
  return rows;
}

const find = (document: ProseMirrorNode, type: string) => walk(document).filter((row) => row.type === type);

function bodyFailure(operation: () => unknown): string {
  try {
    operation();
  } catch (cause) {
    expect(cause).toBeInstanceOf(Error);
    return (cause as VaultBodyError).reason;
  }
  throw new Error('expected a VaultBodyError');
}

describe('M03 createVaultResolver: Obsidian target spellings', () => {
  test('resolves full vault paths, relative paths and .md suffixes', () => {
    expect(resolver.resolvePage('Projects/roadmap', 'Index')?.pageId).toBe('22222222-2222-4222-8222-222222222222');
    expect(resolver.resolvePage('roadmap.md', 'Index')?.pageId).toBe('22222222-2222-4222-8222-222222222222');
    expect(resolver.resolvePage('./roadmap', 'Projects')?.pageId).toBe('22222222-2222-4222-8222-222222222222');
    expect(resolver.resolvePage('../deep/dive', 'Projects/roadmap')?.pageId).toBe('33333333-3333-4333-8333-333333333333');
    expect(resolver.resolvePage('/Projects/roadmap', 'Index')?.pageId).toBe('22222222-2222-4222-8222-222222222222');
  });

  test('a basename unique in the vault resolves while an ambiguous one does not', () => {
    expect(resolver.resolvePage('roadmap', 'Index')?.pageId).toBe('22222222-2222-4222-8222-222222222222');
    expect(resolver.resolvePage('Duplicated', 'Index')).toBeUndefined();
    expect(resolver.resolvePage('Duplicated.md', 'Index')).toBeUndefined();
    expect(resolver.resolvePage('folder/Duplicated', 'Index')?.pageId).toBe('55555555-5555-4555-8555-555555555555');
  });

  test('attachments resolve by path, basename and relative reference', () => {
    expect(resolver.resolveAttachment('assets/photo.png', 'Index')?.hash).toBe(HASH_PNG);
    expect(resolver.resolveAttachment('photo.png', 'Index')?.hash).toBe(HASH_PNG);
    expect(resolver.resolveAttachment('./photo.png', 'assets')?.hash).toBe(HASH_PNG);
    expect(resolver.resolveAttachment('missing.png', 'Index')).toBeUndefined();
  });
});

describe('M03 importVaultBody: vault syntax to the knowledge document model', () => {
  test('wiki links gain pageId by vault resolution; unresolved links keep their target text', () => {
    const document = importVaultBody('参见 [[Projects/roadmap|路线图]]、[[Index]] 与 [[Ghost]]。', 'Index', resolver);
    const links = find(document, 'wikiLink').map((row) => { const { knowledgeBaseId: _target, ...attrs } = row.attrs; return attrs; });
    expect(links).toEqual([
      { pageId: '22222222-2222-4222-8222-222222222222', target: 'Projects/roadmap', label: '路线图', targetBlockId: null, annotations: null },
      { pageId: '11111111-1111-4111-8111-111111111111', target: 'Index', label: null, targetBlockId: null, annotations: null },
      { pageId: null, target: 'Ghost', label: null, targetBlockId: null, annotations: null },
    ]);
  });

  test('a standalone image embed becomes an image block addressed by asset hash', () => {
    const document = importVaultBody('![[assets/photo.png|示意图]]', 'Index', resolver);
    expect(find(document, 'image').map((row) => row.attrs.src)).toEqual([`asset:${HASH_PNG}`]);
    expect(find(document, 'image')[0]!.attrs.alt).toBe('示意图');
  });

  test('a standalone non-image embed becomes the matching media directive; a pdf is a file block', () => {
    const document = importVaultBody('![[assets/report.pdf]]', 'Index', resolver);
    expect(find(document, 'file').map((row) => row.attrs.src)).toEqual([`asset:${HASH_PDF}`]);
  });

  test('a standalone page embed becomes a page-link; a block embed becomes a block-reference', () => {
    const document = importVaultBody('![[Projects/roadmap]]\n\n![[Projects/roadmap#^abc123]]', 'Index', resolver);
    expect(find(document, 'pageLink').map((row) => row.attrs.pageId)).toEqual(['22222222-2222-4222-8222-222222222222']);
    expect(find(document, 'blockReference').map((row) => row.attrs)).toEqual([
      expect.objectContaining({ pageId: '22222222-2222-4222-8222-222222222222', targetBlockId: 'abc123' }),
    ]);
  });

  test('an image embed mixed with text keeps its content: the M01 pipeline hoists atom media blocks', () => {
    const inline = importVaultBody('前缀 ![[assets/pic.jpg]] 后缀', 'Index', resolver);
    expect(find(inline, 'image').map((row) => row.attrs.src)).toEqual([`asset:${HASH_JPG}`]);
    expect(find(inline, 'paragraph').length).toBe(2);
    expect(bodyFailure(() => importVaultBody('前缀 ![[Projects/roadmap]] 后缀', 'Index', resolver))).toBe('embed_not_inline');
    expect(bodyFailure(() => importVaultBody('前缀 ![[assets/report.pdf]] 后缀', 'Index', resolver))).toBe('embed_not_inline');
  });

  test('markdown image references resolve vault attachments, including URL-encoded paths; external URLs pass through', () => {
    const document = importVaultBody('![alt](assets/photo.png)\n\n![ext](https://example.com/x.png)', 'Index', resolver);
    expect(find(document, 'image').map((row) => row.attrs.src)).toEqual([`asset:${HASH_PNG}`, 'https://example.com/x.png']);
    const encoded = createVaultResolver([], [{ path: 'assets/我的 图片.png', hash: HASH_PNG, mime: 'image/png' }]);
    expect(find(importVaultBody('![](assets/%E6%88%91%E7%9A%84%20%E5%9B%BE%E7%89%87.png)', 'Index', encoded), 'image')[0]!.attrs.src).toBe(`asset:${HASH_PNG}`);
  });

  test('structured failures: unknown embed target, missing attachment, invalid markdown', () => {
    expect(bodyFailure(() => importVaultBody('![[Ghost]]', 'Index', resolver))).toBe('embed_target_missing');
    expect(bodyFailure(() => importVaultBody('![](nowhere.png)', 'Index', resolver))).toBe('attachment_missing');
    expect(bodyFailure(() => importVaultBody('::unknown-thing{a="1"}\n', 'Index', resolver))).toBe('markdown_invalid');
  });

  test('media directives exported with vault paths map back to asset sources on re-import', () => {
    // 导出端把视频/音频/文件块的资产源写成压缩包内路径;再导入必须还原为 asset:hash。
    const exported = `::file{src='_attachments/${HASH_PDF}.pdf' title='规格'}\n\n::video{src='_attachments/${HASH_PNG}.png'}\n`;
    const roundTrip = createVaultResolver([], [
      { path: `_attachments/${HASH_PDF}.pdf`, hash: HASH_PDF, mime: 'application/pdf' },
      { path: `_attachments/${HASH_PNG}.png`, hash: HASH_PNG, mime: 'video/mp4' },
    ]);
    const document = importVaultBody(exported, 'Index', roundTrip);
    expect(find(document, 'file').map((row) => row.attrs.src)).toEqual([`asset:${HASH_PDF}`]);
    expect(find(document, 'video').map((row) => row.attrs.src)).toEqual([`asset:${HASH_PNG}`]);
    expect(bodyFailure(() => importVaultBody(`::file{src='_attachments/ghost.pdf'}`, 'Index', roundTrip))).toBe('attachment_missing');
  });

  test('every imported block leaves the repair pass with a valid unique blockId (E02)', () => {
    const document = importVaultBody('# 标题\n\n段落一\n\n- 列表项\n\n> 引用\n', 'Index', resolver);
    const ids = walk(document).map((row) => row.attrs.blockId).filter((value): value is string => typeof value === 'string');
    expect(ids.length).toBeGreaterThan(3);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });
});

describe('M03 exportVaultBody: the knowledge document model back to vault syntax', () => {
  test('archive references bind the destination library while explicit foreign references retain their full target', () => {
    const localId = exportContext().knowledgeBaseId;
    const foreignId = '20000000-0000-4000-8000-000000000001';
    const pageId = '22222222-2222-4222-8222-222222222222';
    const local = bindImportedReferenceKnowledgeBase(importVaultBody('![[Projects/roadmap]]\n\n![[Projects/roadmap#^anchor]]', 'Index', resolver), localId);
    expect(find(local, 'pageLink')[0]!.attrs.knowledgeBaseId).toBe(localId);
    expect(find(local, 'blockReference')[0]!.attrs.knowledgeBaseId).toBe(localId);
    const nodes = markdownSchema().nodes;
    const document = nodes.doc.createChecked(null, [
      nodes.pageLink.createChecked({ blockId: 'foreign-page', knowledgeBaseId: foreignId, pageId }),
      nodes.blockReference.createChecked({ blockId: 'foreign-block', knowledgeBaseId: foreignId, pageId, targetBlockId: 'foreign-target' }),
      nodes.paragraph.createChecked({ blockId: 'foreign-wiki' }, nodes.wikiLink.createChecked({ knowledgeBaseId: foreignId, pageId, target: 'Foreign' })),
    ]);
    // The same page UUID exists in the local archive map: scope decides the target.
    const restored = bindImportedReferenceKnowledgeBase(importVaultBody(exportVaultBody(document, exportContext()), 'Index', resolver), localId);
    for (const kind of ['pageLink', 'blockReference', 'wikiLink']) {
      expect(find(restored, kind)[0]!.attrs).toMatchObject({ knowledgeBaseId: foreignId, pageId });
    }
  });
  test('wiki links with a resolved pageId export as vault note paths; unresolved ones keep their target', () => {
    const document = importVaultBody('参见 [[Projects/roadmap|路线图]] 与 [[Ghost]]。', 'Index', resolver);
    const exported = exportVaultBody(document, exportContext({ vaultPathOf: () => '基地/Projects/roadmap' }));
    expect(exported).toContain('[[基地/Projects/roadmap|路线图]]');
    expect(exported).toContain('[[Ghost]]');
  });

  test('wiki links nested inside headings and list items are rewritten too', () => {
    const document = importVaultBody('# 标题里的 [[Projects/roadmap]]\n\n- 项目:[[Projects/roadmap|路线]]\n', 'Index', resolver);
    const exported = exportVaultBody(document, exportContext({ vaultPathOf: () => '基地/Projects/roadmap' }));
    expect(exported).toContain('# 标题里的 [[基地/Projects/roadmap]]');
    expect(exported).toContain('[[基地/Projects/roadmap|路线]]');
  });

  test('media sources become vault attachment paths; external URLs stay untouched', () => {
    const document = importVaultBody('![[assets/photo.png]]\n\n![ext](https://example.com/x.png)', 'Index', resolver);
    const exported = exportVaultBody(document, exportContext());
    expect(exported).toContain(`_attachments/${HASH_PNG}.png`);
    expect(exported).toContain('https://example.com/x.png');
    expect(bodyFailure(() => exportVaultBody(importVaultBody('![](data:image/png;base64,xxx)', 'Index', resolver), exportContext()))).toBe('media_source_unexportable');
  });

  test('block and page references export with the note path and import back to the same pageId', () => {
    const document = importVaultBody('![[Projects/roadmap#^abc123]]\n\n![[Projects/roadmap]]', 'Index', resolver);
    const exported = exportVaultBody(document, exportContext());
    expect(exported).toContain(`::block-reference{pageId='Projects/roadmap' targetBlockId='abc123'`);
    const reimported = importVaultBody(exported, 'Index', resolver);
    expect(find(reimported, 'blockReference').map((row) => row.attrs)).toEqual([
      expect.objectContaining({ pageId: '22222222-2222-4222-8222-222222222222', targetBlockId: 'abc123' }),
    ]);
    expect(find(reimported, 'pageLink').map((row) => row.attrs.pageId)).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

  test('a full page survives export → import → export without drift', () => {
    const source = '# 季度目标\n\n参见 [[Index]] 的说明。\n\n![[assets/photo.png|架构图]]\n\n- [ ] 事项一\n- [x] 事项二\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```\n\n$E = mc^2$\n';
    const first = importVaultBody(source, 'Projects/roadmap', resolver);
    const once = exportVaultBody(first, exportContext());
    // 再导入的 vault 与导出端同构:附件位于 _attachments/,页面路径不变。
    const reimportResolver = createVaultResolver(
      [
        { path: 'Index', pageId: '11111111-1111-4111-8111-111111111111' },
        { path: 'Projects/roadmap', pageId: '22222222-2222-4222-8222-222222222222' },
      ],
      [{ path: `_attachments/${HASH_PNG}.png`, hash: HASH_PNG, mime: 'image/png' }],
    );
    const twice = exportVaultBody(importVaultBody(once, 'Projects/roadmap', reimportResolver), exportContext());
    expect(twice).toBe(once);
  });
});

describe('M03 reference collectors for the export planner', () => {
  test('collectAssetReferences dedupes in document order', () => {
    const document = importVaultBody('![[assets/pic.jpg]]\n\n![[assets/photo.png]]\n\n![[assets/pic.jpg|再来一次]]', 'Index', resolver);
    expect(collectAssetReferences(document)).toEqual([HASH_JPG, HASH_PNG]);
  });

  test('collectAnchorReferences gathers wiki and block-reference anchors only once', () => {
    const document = importVaultBody('[[Projects/roadmap#^anchor1]]\n\n![[Projects/roadmap#^anchor2]]\n\n![[Projects/roadmap#^anchor2]]', 'Index', resolver);
    expect(collectAnchorReferences(document).sort()).toEqual(['anchor1', 'anchor2']);
  });
});

describe('M03 schema sharing with the M01 pipeline', () => {
  test('markdownSchema is the knowledge schema used by the pipeline', () => {
    expect(markdownSchema().spec.nodes).toBeDefined();
    expect(markdownSchema().nodes.wikiLink).toBeDefined();
    expect(markdownSchema().nodes.blockReference).toBeDefined();
  });
});
