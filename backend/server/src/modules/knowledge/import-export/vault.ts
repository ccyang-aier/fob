import { unzipSync, zipSync } from 'fflate';
import type { Properties } from '@fob/shared/knowledge/contracts';
import { KnowledgeVaultError } from './errors';
import { decodeFrontmatter, encodeFrontmatter, splitFrontmatter } from './frontmatter';
import type { VaultFrontmatter } from './frontmatter';

/**
 * Obsidian vault 打包层(M03 §4.4):zip 字节 ⇄ {页面树, 附件}。
 *
 * 目录结构即页面树路径:子页面是其父页面文件夹下的 `.md` 文件;一个仅作为
 * 目录出现、没有对应笔记的文件夹不产生页面(其内容挂到最近的祖先笔记)。
 * 附件不导入为页面:非 `.md` 文件一律是附件,vault 内任意位置都可引用。
 * 以 `.` 开头的段(`.obsidian/`、`.DS_Store` 等)是编辑器/系统文件,跳过。
 */

export const ATTACHMENTS_DIR = '_attachments';
const PAGE_EXTENSION = '.md';

/** zip 炸弹护栏:条目数与解压总量上限。 */
const MAX_ENTRIES = 20_000;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

export interface VaultPage {
  /** 无扩展名的 posix 路径(`notes/2026/plan`),唯一。 */
  readonly path: string;
  /** 文件名去掉扩展名,经标题净化。 */
  readonly title: string;
  readonly properties: Properties;
  readonly icon: string | null;
  /** 不含 frontmatter 的正文 Markdown。 */
  readonly markdown: string;
}

export interface VaultAttachment {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ParsedVault {
  readonly pages: readonly VaultPage[];
  readonly attachments: readonly VaultAttachment[];
}

export type VaultParseFailure = { path: string; reason: string };

const posix = (value: string) => value.replaceAll('\\', '/');

/** 压缩包条目名:拒绝目录条目、隐藏段、`..`/盘符等逃逸。 */
function acceptableEntry(name: string): string | null {
  const normalized = posix(name);
  if (normalized === '' || /^([a-zA-Z]:)?\//.test(normalized) || normalized.split('/').includes('..')) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0)) return null;
  if (segments.some((segment) => segment.startsWith('.'))) return null;
  return segments.join('/');
}

const ILLEGAL_TITLE = /[\u0000-\u001f\u007f\\/:%*?"<>|#^[\]]/g;
const MAX_TITLE_LENGTH = 120;

/** 文件名 → 页面标题:去非法字符、折叠空白、限长;空结果落到 Untitled。 */
export function titleFromFileName(name: string): string {
  const cleaned = name.replace(ILLEGAL_TITLE, ' ').replaceAll(/\s+/g, ' ').trim();
  const trimmed = cleaned.length > MAX_TITLE_LENGTH ? cleaned.slice(0, MAX_TITLE_LENGTH).trim() : cleaned;
  return trimmed.length ? trimmed : 'Untitled';
}

/** 标题 → 文件名(不含扩展名):标题本身已净化,这里只保证非空与限长。 */
export function fileNameFromTitle(title: string): string {
  const cleaned = title.replace(ILLEGAL_TITLE, ' ').replaceAll(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH).trim();
  return cleaned.length ? cleaned : 'Untitled';
}

export interface VaultParseOutcome {
  readonly vault: ParsedVault;
  /** frontmatter 解析失败的页面(逐项失败,不阻塞其余页面)。 */
  readonly failures: readonly VaultParseFailure[];
}

export function parseVaultArchive(archive: Uint8Array): VaultParseOutcome {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive, { filter: (file) => !file.name.endsWith('/') });
  } catch (cause) {
    throw new KnowledgeVaultError('VAULT_ARCHIVE_INVALID', '压缩包不是有效的 zip 归档', { cause });
  }
  const names = Object.keys(entries);
  if (names.length > MAX_ENTRIES) throw new KnowledgeVaultError('VAULT_ARCHIVE_INVALID', `压缩包条目超过上限 ${MAX_ENTRIES}`);
  let total = 0;
  const accepted: { path: string; bytes: Uint8Array }[] = [];
  for (const name of names) {
    const path = acceptableEntry(name);
    if (!path) continue;
    const bytes = entries[name]!;
    total += bytes.byteLength;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new KnowledgeVaultError('VAULT_ARCHIVE_INVALID', `解压总量超过上限 ${MAX_UNCOMPRESSED_BYTES} 字节`);
    accepted.push({ path, bytes });
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const pages: VaultPage[] = [];
  const attachments: VaultAttachment[] = [];
  const failures: VaultParseFailure[] = [];
  for (const entry of accepted) {
    if (!entry.path.toLowerCase().endsWith(PAGE_EXTENSION)) {
      attachments.push({ path: entry.path, bytes: entry.bytes });
      continue;
    }
    const fileName = entry.path.slice(entry.path.lastIndexOf('/') + 1, -PAGE_EXTENSION.length);
    let source: string;
    try {
      source = decoder.decode(entry.bytes);
    } catch {
      failures.push({ path: entry.path, reason: 'page_not_utf8' });
      continue;
    }
    const { frontmatter, body } = splitFrontmatter(source);
    let metadata: VaultFrontmatter = { properties: {}, icon: null };
    if (frontmatter !== null) {
      try {
        metadata = decodeFrontmatter(frontmatter);
      } catch (cause) {
        failures.push({ path: entry.path, reason: cause instanceof Error && 'reason' in cause ? `frontmatter_${(cause as { reason: string }).reason}` : 'frontmatter_invalid' });
        continue;
      }
    }
    pages.push({ path: entry.path.slice(0, -PAGE_EXTENSION.length), title: titleFromFileName(fileName), properties: metadata.properties, icon: metadata.icon, markdown: body });
  }

  const pagePaths = new Set(pages.map((page) => page.path));
  if (pagePaths.size !== pages.length) throw new KnowledgeVaultError('VAULT_TREE_INVALID', '页面路径在压缩包内重复');
  return { vault: { pages, attachments }, failures };
}

/** 父页面 = 路径上最长的祖先笔记;没有祖先笔记的页面是根级页面。 */
export function parentPathOf(path: string, pagePaths: ReadonlySet<string>): string | null {
  const segments = path.split('/');
  for (let depth = segments.length - 1; depth >= 1; depth--) {
    const ancestor = segments.slice(0, depth).join('/');
    if (pagePaths.has(ancestor)) return ancestor;
  }
  return null;
}

/**
 * 导出文件名约定:有子页面的页面映射为 `Title/Title.md`(子页面在其文件夹
 * 内);叶子页面映射为 `父目录/Title.md`。返回值不带扩展名。
 */
export function vaultPathsForExport(pages: readonly { id: string; title: string; parentId: string | null }[]): Map<string, string> {
  interface TreePage { id: string; title: string; parentId: string | null }
  const byParent = new Map<string | null, TreePage[]>();
  for (const page of pages) {
    const bucket = byParent.get(page.parentId) ?? [];
    bucket.push(page);
    byParent.set(page.parentId, bucket);
  }
  // 同父文件名去重:按组内顺序首个保留原名,后续追加 ` 2`、` 3`……
  const namesByParent = new Map<string | null, Map<string, string>>();
  for (const [parentId, group] of byParent) {
    const taken = new Set<string>();
    const names = new Map<string, string>();
    for (const page of group) {
      const base = fileNameFromTitle(page.title);
      let name = base;
      for (let attempt = 2; taken.has(name); attempt++) name = `${base} ${attempt}`;
      taken.add(name);
      names.set(page.id, name);
    }
    namesByParent.set(parentId, names);
  }
  const assign = (page: TreePage, directory: string): void => {
    const name = namesByParent.get(page.parentId)!.get(page.id)!;
    const note = directory === '' ? name : `${directory}/${name}`;
    notes.set(page.id, note);
    for (const child of byParent.get(page.id) ?? []) assign(child, note);
  };
  const notes = new Map<string, string>();
  for (const root of byParent.get(null) ?? []) assign(root, '');
  return notes;
}

export interface ExportVaultPage {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly properties: Properties;
  readonly icon: string | null;
  readonly markdown: string;
}

export function buildVaultArchive(pages: readonly ExportVaultPage[], attachments: readonly VaultAttachment[]): Uint8Array {
  const notes = vaultPathsForExport(pages.map(({ id, title, parentId }) => ({ id, title, parentId })));
  const entries: Record<string, Uint8Array> = {};
  const encoder = new TextEncoder();
  for (const page of pages) {
    const note = notes.get(page.id);
    if (!note) throw new KnowledgeVaultError('VAULT_TREE_INVALID', `导出页面 ${page.id} 不在树上`);
    const frontmatter = encodeFrontmatter({ properties: page.properties, icon: page.icon });
    entries[`${note}${PAGE_EXTENSION}`] = encoder.encode(`${frontmatter ?? ''}${page.markdown}`);
  }
  for (const attachment of attachments) {
    const name = attachment.path.split('/').at(-1)!;
    entries[`${ATTACHMENTS_DIR}/${name}`] = attachment.bytes;
  }
  return zipSync(entries, { level: 6 });
}
