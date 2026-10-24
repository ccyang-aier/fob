import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { NotionArchive, NotionArchiveAttachment, NotionArchiveDatabase, NotionArchivePage, NotionImportWarning } from './notion-types';

/**
 * Notion 导出包扫描:目录层级即页面树(页面文件旁的 `<标题> <hash>` 同名目录承载
 * 它的子页面与附件),`<标题> <hash>.html|.md` 是页面,`.csv` 是数据库视图,其余是
 * 附件。键一律是导出内 POSIX 风格的解码相对路径,供 href/引用解析共用。
 */

const HASH_SUFFIX = /^(.*) [0-9a-f]{8,32}$/;
const VIEW_SUFFIX = /\s+\([^)]+\)$/;
const PAGE_EXTENSIONS = new Set(['.html', '.md']);

export function notionTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.(html|md|csv)$/i, '');
  return HASH_SUFFIX.exec(base)?.[1]?.trim() || base.trim();
}

/** href(可能百分号编码、带锚点)→ 导出内相对键;无法解码时按原文处理。 */
export function resolveNotionReference(fromDirectory: string, reference: string): string {
  let href = reference;
  try { href = decodeURIComponent(reference); } catch { /* 保留原始编码 */ }
  const withoutAnchor = href.split('#')[0]!.split('?')[0]!;
  if (!withoutAnchor) return '';
  const segments = [...fromDirectory.split('/').filter(Boolean), ...withoutAnchor.split('/')];
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') normalized.pop();
    else normalized.push(segment);
  }
  return normalized.join('/');
}

async function list(dir: string): Promise<{ files: string[]; directories: string[] }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  const directories: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile()) files.push(entry.name);
    else if (entry.isDirectory()) directories.push(entry.name);
  }
  return { files, directories };
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** 页面文件旁的同名目录是该页面的子页面/附件容器;找不到返回 null。 */
function directoryOwner(dirKey: string, pageKeys: ReadonlySet<string>): string | null {
  if (!dirKey) return null;
  const separator = dirKey.lastIndexOf('/');
  const parent = separator < 0 ? '' : dirKey.slice(0, separator);
  const base = dirKey.slice(separator + 1);
  for (const suffix of PAGE_EXTENSIONS) {
    const key = [parent, `${base}${suffix}`].filter(Boolean).join('/');
    if (pageKeys.has(key)) return key;
  }
  return null;
}

/**
 * 扫描导出根目录。若根目录没有页面文件而只有一个子目录(Notion 打包常见的
 * `Export-<id>/` 外壳),向下进入该外壳,最多五层。
 */
export async function scanNotionArchive(rootDir: string): Promise<NotionArchive> {
  const warnings: NotionImportWarning[] = [];
  let root = rootDir;
  for (let depth = 0; depth < 5; depth++) {
    const { files, directories } = await list(root);
    if (files.some((name) => PAGE_EXTENSIONS.has(extension(name)))) break;
    if (directories.length === 1) {
      root = join(root, directories[0]!);
      continue;
    }
    break;
  }

  const pages: NotionArchivePage[] = [];
  const databases: NotionArchiveDatabase[] = [];
  const attachments: NotionArchiveAttachment[] = [];
  const pageKeys = new Set<string>();
  const walk = async (dir: string, dirKey: string): Promise<void> => {
    const { files, directories } = await list(dir);
    for (const name of files) {
      const key = [dirKey, name].filter(Boolean).join('/');
      const ext = extension(name);
      if (PAGE_EXTENSIONS.has(ext)) {
        pages.push({ key, filenameTitle: notionTitleFromFilename(name), format: ext === '.md' ? 'markdown' : 'html', parentKey: null });
        pageKeys.add(key);
      } else if (ext === '.csv') {
        databases.push({ key, filenameTitle: notionTitleFromFilename(name), parentKey: null });
      } else {
        attachments.push({ key, name, parentKey: null });
      }
    }
    for (const name of directories) {
      await walk(join(dir, name), [dirKey, name].filter(Boolean).join('/'));
    }
  };
  await walk(root, '');

  // 目录所有权依赖全部页面键已知,两遍完成:先收集页面,再回填归属。
  const owners = new Map<string, string>();
  const resolveOwner = (dirKey: string): string | null => {
    if (!dirKey) return null;
    if (!owners.has(dirKey)) owners.set(dirKey, directoryOwner(dirKey, pageKeys) ?? '');
    return owners.get(dirKey) || null;
  };
  const parentOf = (key: string): string | null => {
    const separator = key.lastIndexOf('/');
    return separator < 0 ? null : resolveOwner(key.slice(0, separator));
  };
  for (const page of pages) page.parentKey = parentOf(page.key);
  for (const database of databases) database.parentKey = parentOf(database.key);
  for (const attachment of attachments) attachment.parentKey = parentOf(attachment.key);

  // 同一数据库的附加视图(文件名带 "(视图名)" 后缀)只导入首个,其余显式跳过。
  const seenBases = new Set<string>();
  const kept: NotionArchiveDatabase[] = [];
  for (const database of databases) {
    const separator = database.key.lastIndexOf('/');
    const base = database.key.slice(separator + 1).replace(/\.csv$/i, '').replace(VIEW_SUFFIX, '');
    const identity = `${database.key.slice(0, separator < 0 ? 0 : separator + 1)}${base}`;
    if (seenBases.has(identity)) {
      warnings.push({ source: database.key, code: 'skipped_view', detail: '同一数据库的附加视图,首个视图已导入' });
      continue;
    }
    seenBases.add(identity);
    kept.push(database);
  }

  return { rootDir: root, pages, databases: kept, attachments, warnings };
}
