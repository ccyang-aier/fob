import { describe, expect, test } from 'bun:test';
import { unzipSync, zipSync } from 'fflate';
import { KnowledgeVaultError } from './errors';
import { buildVaultArchive, parentPathOf, parseVaultArchive, titleFromFileName, fileNameFromTitle, vaultPathsForExport } from './vault';

const encoder = new TextEncoder();
const zip = (entries: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, typeof value === 'string' ? encoder.encode(value) : value])));

describe('M03 parseVaultArchive: directory tree, attachments and frontmatter', () => {
  test('maps the vault directory tree to pages and keeps non-markdown files as attachments', () => {
    const { vault, failures } = parseVaultArchive(zip({
      'Welcome.md': '欢迎',
      'Projects.md': '项目根',
      'Projects/roadmap.md': '路线图',
      'Projects/deep/notes.md': '深层笔记',
      'Journal/2026/day1.md': '没有 Journal.md 的目录',
      'assets/photo.png': new Uint8Array([1, 2, 3]),
      'report.pdf': new Uint8Array([4]),
    }));
    expect(failures).toEqual([]);
    expect(vault.pages.map((page) => page.path)).toEqual(['Welcome', 'Projects', 'Projects/roadmap', 'Projects/deep/notes', 'Journal/2026/day1']);
    expect(vault.attachments.map((attachment) => attachment.path)).toEqual(['assets/photo.png', 'report.pdf']);
    expect(vault.attachments[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('parses frontmatter into properties and icon while keeping the body verbatim', () => {
    const { vault } = parseVaultArchive(zip({
      'note.md': '---\nicon: 📌\ntags:\n  - work\nstatus: done\nrank: 3\npinned: true\nquiet: null\n---\n正文第一行\n\n第二行\n',
    }));
    expect(vault.pages).toEqual([{
      path: 'note', title: 'note', icon: '📌',
      properties: { tags: ['work'], status: 'done', rank: 3, pinned: true, quiet: null },
      markdown: '正文第一行\n\n第二行\n',
    }]);
  });

  test('skips editor and system entries that start with a dot segment', () => {
    const { vault } = parseVaultArchive(zip({
      '.obsidian/app.json': '{}',
      'notes/.DS_Store': new Uint8Array([0]),
      'notes/real.md': '内容',
    }));
    expect(vault.pages.map((page) => page.path)).toEqual(['notes/real']);
    expect(vault.attachments).toEqual([]);
  });

  test('reports per-page failures without dropping the healthy pages', () => {
    const broken = new Uint8Array([0xff, 0xfe, 0x00, 0xfd]);
    const { vault, failures } = parseVaultArchive(zip({
      'good.md': '好页面',
      'binary.md': broken,
      'bad-yaml.md': '---\nicon: [1\n---\n正文',
      'bad-key.md': '---\n"date created": 2026-01-01\n---\n正文',
    }));
    expect(failures).toEqual([
      { path: 'binary.md', reason: 'page_not_utf8' },
      { path: 'bad-yaml.md', reason: 'frontmatter_syntax' },
      { path: 'bad-key.md', reason: 'frontmatter_property_id' },
    ]);
    expect(vault.pages.map((page) => page.path)).toEqual(['good']);
  });

  test('rejects archives that are not zip or that escape the vault root', () => {
    expect(() => parseVaultArchive(encoder.encode('not a zip'))).toThrow(KnowledgeVaultError);
    for (const name of ['/etc/passwd.md', 'C:\\temp\\x.md', 'a//b.md', 'a/../evil.md', '../evil.md']) {
      const outcome = parseVaultArchive(zip({ [name]: 'x' }));
      expect(outcome.vault.pages).toEqual([]);
      expect(outcome.vault.attachments).toEqual([]);
    }
  });

  test('case-differing markdown extensions that collapse onto one page path are refused', () => {
    expect(() => parseVaultArchive(zip({ 'dup.md': 'x', 'dup.MD': 'y' }))).toThrow(KnowledgeVaultError);
  });

  test('an empty markdown page still imports with empty body', () => {
    expect(parseVaultArchive(zip({ 'Empty.md': '' })).vault.pages.map((page) => page.markdown)).toEqual(['']);
  });

  test('case-insensitive markdown extensions still parse while the page path drops the extension', () => {
    const { vault } = parseVaultArchive(zip({ 'NOTE.MD': '大写扩展' }));
    expect(vault.pages.map((page) => page.path)).toEqual(['NOTE']);
    expect(vault.attachments).toEqual([]);
  });
});

describe('M03 parentPathOf: longest ancestor note', () => {
  const pagePaths = new Set(['Projects', 'Projects/roadmap', 'Projects/deep/notes', 'Journal/2026/day1', 'Welcome']);

  test('a note inside a note folder becomes its child', () => {
    expect(parentPathOf('Projects/roadmap', pagePaths)).toBe('Projects');
    expect(parentPathOf('Projects/deep/notes', pagePaths)).toBe('Projects');
  });

  test('a folder without its own note falls back to the closest ancestor note, then the vault root', () => {
    expect(parentPathOf('Journal/2026/day1', pagePaths)).toBeNull();
    expect(parentPathOf('Welcome', pagePaths)).toBeNull();
    expect(parentPathOf('Projects/roadmap/more/deeper/page', pagePaths)).toBe('Projects/roadmap');
  });
});

describe('M03 title and filename sanitisation', () => {
  test('titleFromFileName strips illegal characters, collapses whitespace and clamps length', () => {
    expect(titleFromFileName('What? A "plan"!')).toBe('What A plan !');
    expect(titleFromFileName('a  \t b')).toBe('a b');
    expect(titleFromFileName('***')).toBe('Untitled');
    expect(titleFromFileName('x'.repeat(500)).length).toBe(120);
  });

  test('fileNameFromTitle mirrors the same rules for export', () => {
    expect(fileNameFromTitle('根/子: 页面')).toBe('根 子 页面');
    expect(fileNameFromTitle('   ')).toBe('Untitled');
    expect(fileNameFromTitle('a|b#c')).toBe('a b c');
  });
});

describe('M03 vaultPathsForExport and buildVaultArchive', () => {
  test('children live inside their parent note folder and same-title siblings are deduped uniquely', () => {
    const paths = vaultPathsForExport([
      { id: '1', title: 'Projects', parentId: null },
      { id: '2', title: 'Projects', parentId: null },
      { id: '3', title: 'Projects', parentId: null },
      { id: '4', title: 'Roadmap', parentId: '1' },
      { id: '5', title: 'Roadmap', parentId: '2' },
    ]);
    expect(paths.get('1')).toBe('Projects');
    expect(paths.get('2')).toBe('Projects 2');
    expect(paths.get('3')).toBe('Projects 3');
    expect(paths.get('4')).toBe('Projects/Roadmap');
    expect(paths.get('5')).toBe('Projects 2/Roadmap');
    expect(new Set(paths.values()).size).toBe(paths.size);
  });

  test('buildVaultArchive round trips through parseVaultArchive with frontmatter re-encoded', () => {
    const archive = buildVaultArchive(
      [
        { id: 'p1', title: '根页面', parentId: null, properties: { tags: ['a', 'b'], rank: 1 }, icon: '🌟', markdown: '# 根\n\n正文\n' },
        { id: 'p2', title: '子页面', parentId: 'p1', properties: {}, icon: null, markdown: '子正文\n' },
      ],
      [{ path: '_attachments/aa.png', bytes: new Uint8Array([7, 8]) }],
    );
    const { vault, failures } = parseVaultArchive(archive);
    expect(failures).toEqual([]);
    expect(vault.pages.map((page) => ({ path: page.path, title: page.title, icon: page.icon, markdown: page.markdown }))).toEqual([
      { path: '根页面', title: '根页面', icon: '🌟', markdown: '# 根\n\n正文\n' },
      { path: '根页面/子页面', title: '子页面', icon: null, markdown: '子正文\n' },
    ]);
    expect(vault.pages[0]!.properties).toEqual({ tags: ['a', 'b'], rank: 1 });
    expect(vault.attachments).toEqual([{ path: '_attachments/aa.png', bytes: new Uint8Array([7, 8]) }]);
  });

  test('pages without properties or icon stay plain markdown files', () => {
    const archive = buildVaultArchive([{ id: 'p', title: 'Plain', parentId: null, properties: {}, icon: null, markdown: '只正文\n' }], []);
    const entries = unzipSync(archive);
    expect(Object.keys(entries)).toEqual(['Plain.md']);
    expect(new TextDecoder().decode(entries['Plain.md']!)).toBe('只正文\n');
  });

  test('pages outside the reachable tree (parentId cycle) are refused, not silently dropped', () => {
    expect(() => buildVaultArchive(
      [
        { id: 'a', title: 'A', parentId: 'b', properties: {}, icon: null, markdown: '' },
        { id: 'b', title: 'B', parentId: 'a', properties: {}, icon: null, markdown: '' },
      ],
      [],
    )).toThrow(KnowledgeVaultError);
  });
});
