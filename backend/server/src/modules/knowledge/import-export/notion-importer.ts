import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import type { MarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { docState } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { confirmKnowledgeBaseAssetUpload, prepareKnowledgeBaseAssetUpload } from '../assets/service';
import type { KnowledgeAssetStorage } from '../assets/storage';
import { createAuthorizedDatabase, createAuthorizedRow } from '../databases/service';
import { createAuthorizedPage } from '../pages/tree';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { resolveNotionReference, scanNotionArchive } from './notion-archive';
import { finalizeNotionBody } from './notion-body';
import { bindImportedReferenceKnowledgeBase } from './body';
import { encodeNotionPageState } from './notion-document';
import { parseNotionCsv } from './notion-csv';
import { parseNotionHtml } from './notion-html';
import type {
  NotionImportFailure,
  NotionImportedAsset,
  NotionImportedDatabase,
  NotionImportedPage,
  NotionImportProgress,
  NotionImportReport,
  NotionImportWarning,
  NotionParsedDatabase,
} from './notion-types';

/**
 * M04 Notion 导入编排。复用既有能力而非旁路:正文走 M01(HTML/Markdown → mdast →
 * PM)、页面树走 T01 createAuthorizedPage、数据库与行走 T02 createAuthorizedDatabase/
 * Row、附件走 AS01 prepare/PUT/confirm(服务端充当上传客户端)、正文以 B02 语义落
 * doc_state 并以真实 actor 发 doc.changed(索引/反链消费者照常运转)。逐项失败隔离,
 * 汇总报告;授权边界归 P03:调用方须先验证 userId 及 parentPageId 的写权限。
 */

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.txt': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});

type MdastRoot = Parameters<MarkdownPipeline['fromMdast']>[0];

interface ParsedPage {
  readonly title: string;
  readonly document: ProseMirrorNode | null;
  readonly database: NotionParsedDatabase | null;
}

interface EncodedBody {
  readonly state: Buffer;
  readonly stateVector: Buffer;
}

const titleOf = (value: string): string => value.slice(0, 500);
const depthOf = (key: string): number => key.split('/').length;
const directoryOf = (key: string): string => {
  const separator = key.lastIndexOf('/');
  return separator < 0 ? '' : key.slice(0, separator);
};

/** 空正文(仅空段落)不落 doc_state:B02 只持久化真实正文。 */
function bodyIsEmpty(document: ProseMirrorNode): boolean {
  if (document.textContent.trim() !== '') return false;
  let empty = true;
  document.forEach((child) => {
    if (child.type.name !== 'paragraph' || child.childCount > 0) empty = false;
  });
  return empty;
}

export interface NotionImportOptions {
  readonly pool: Pool;
  readonly storage: KnowledgeAssetStorage;
  readonly rootDir: string;
  readonly knowledgeBaseId: string;
  readonly teamspaceId: string;
  readonly userId: string;
  /** 导出根级页面的落点;null 挂到 teamspace 根。 */
  readonly parentPageId?: string | null;
  readonly onProgress?: NotionImportProgress;
}

export async function importNotionExport(options: NotionImportOptions): Promise<NotionImportReport> {
  const pipeline: MarkdownPipeline = createMarkdownPipeline();
  const warnings: NotionImportWarning[] = [];
  const pages: NotionImportedPage[] = [];
  const databases: NotionImportedDatabase[] = [];
  const assets: NotionImportedAsset[] = [];
  const failures: NotionImportFailure[] = [];
  const progress = options.onProgress ?? (() => undefined);

  // 1) 扫描 + 预分配全部身份(客户端 UUID,T01/T02 幂等语义;链接映射因此与
  //    导入成败解耦:目标页创建失败时显式 pageId 解析为悬链,而非改指他页)。
  const archive = await scanNotionArchive(options.rootDir);
  warnings.push(...archive.warnings);
  const pageIds = new Map<string, string>();
  const databaseIds = new Map<string, string>();
  const titles = new Map<string, string>();
  for (const page of archive.pages) {
    pageIds.set(page.key, randomUUID());
    titles.set(page.key, titleOf(page.filenameTitle || page.key));
  }
  for (const database of archive.databases) {
    databaseIds.set(database.key, randomUUID());
    titles.set(database.key, titleOf(database.filenameTitle || database.key));
  }
  const pageKeys = new Set(pageIds.keys());
  progress({ phase: 'scan', completed: 1, total: 1, source: '' });

  // 2) 解析全部页面正文/数据库。解析失败不阻断:页面仍以文件名标题导入。
  const parsed = new Map<string, ParsedPage>();
  for (const page of archive.pages) {
    try {
      const content = await readFile(join(archive.rootDir, page.key), 'utf8');
      if (page.format === 'html') {
        const result = parseNotionHtml(content, page.key, {
          linkTargetExists: (href) => pageKeys.has(resolveNotionReference(directoryOf(page.key), href)),
        });
        warnings.push(...result.warnings);
        const title = titleOf(result.pageTitle?.trim() || titles.get(page.key)!);
        titles.set(page.key, title);
        parsed.set(page.key, {
          title,
          document: result.database ? null : pipeline.fromMdast(result.mdast as MdastRoot),
          database: result.database,
        });
      } else {
        const title = titles.get(page.key)!;
        parsed.set(page.key, { title, document: pipeline.parse(content), database: null });
      }
    } catch (error) {
      parsed.set(page.key, { title: titles.get(page.key)!, document: null, database: null });
      failures.push({ source: page.key, phase: 'body', message: `正文解析失败,页面按元数据导入: ${(error as Error).message}` });
    }
  }
  const csvDatabases = new Map<string, NotionParsedDatabase>();
  for (const database of archive.databases) {
    try {
      const model = parseNotionCsv(await readFile(join(archive.rootDir, database.key), 'utf8'), database.key);
      if (!model) {
        failures.push({ source: database.key, phase: 'database', message: 'CSV 缺少表头或数据行,未导入' });
        continue;
      }
      csvDatabases.set(database.key, model);
    } catch (error) {
      failures.push({ source: database.key, phase: 'database', message: `CSV 解析失败: ${(error as Error).message}` });
    }
  }

  // 3) 附件经 AS01 上传(服务端作为上传客户端执行 presigned PUT)。
  const assetHashes = new Map<string, string>();
  const attachmentKeys = new Set(archive.attachments.map((attachment) => attachment.key));
  for (const [index, attachment] of archive.attachments.entries()) {
    try {
      const bytes = await readFile(join(archive.rootDir, attachment.key));
      const hash = createHash('sha256').update(bytes).digest('hex');
      const extension = attachment.key.slice(attachment.key.lastIndexOf('.')).toLowerCase();
      const intent = {
        knowledgeBaseId: options.knowledgeBaseId,
        userId: options.userId,
        hash,
        mime: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
        size: bytes.byteLength,
        name: attachment.name,
      };
      const uploaded = await withKnowledgeBase(options.pool, options.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(options.storage, db, intent));
      if (uploaded.action === 'upload') {
        const response = await fetch(uploaded.url, { method: uploaded.method, headers: uploaded.headers, body: bytes });
        if (!response.ok) throw new Error(`对象存储 PUT 失败: HTTP ${response.status}`);
      }
      await withKnowledgeBase(options.pool, options.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(options.storage, db, intent));
      assetHashes.set(attachment.key, hash);
      assets.push({ source: attachment.key, hash, mime: intent.mime, size: intent.size, name: intent.name });
    } catch (error) {
      failures.push({ source: attachment.key, phase: 'asset', message: `附件上传失败: ${(error as Error).message}` });
    } finally {
      progress({ phase: 'assets', completed: index + 1, total: archive.attachments.length, source: attachment.key });
    }
  }

  // 4) 正文构建(纯函数)与落库(与页面/行创建同事务,保持 B02 单写入口)。
  const buildBody = (source: string): EncodedBody | null => {
    const document = parsed.get(source)?.document;
    if (!document || bodyIsEmpty(document)) return null;
    const directory = directoryOf(source);
    const resolver = {
      resolvePage: (href: string): { pageId: string; title: string } | null => {
        const key = resolveNotionReference(directory, href) || source;
        const target = pageIds.get(key) ?? databaseIds.get(key);
        return target ? { pageId: target, title: titles.get(key) ?? '' } : null;
      },
      resolveAttachment: (reference: string) => assetHashes.get(resolveNotionReference(directory, reference)) ?? null,
      knownAttachment: (reference: string) => attachmentKeys.has(resolveNotionReference(directory, reference)),
    };
    const finalized = finalizeNotionBody(pipeline, document, source, resolver);
    warnings.push(...finalized.warnings);
    const encoded = encodeNotionPageState(bindImportedReferenceKnowledgeBase(finalized.document, options.knowledgeBaseId));
    return { state: Buffer.from(encoded.state), stateVector: Buffer.from(encoded.stateVector) };
  };

  const persistBody = async (db: ResourceTransaction, pageId: string, encoded: EncodedBody): Promise<void> => {
    await db.insert(docState).values({ knowledgeBaseId: options.knowledgeBaseId, pageId, state: encoded.state, stateVector: encoded.stateVector })
      .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state: encoded.state, stateVector: encoded.stateVector } });
    await appendKnowledgeOutbox(db, {
      topic: 'doc.changed',
      knowledgeBaseId: options.knowledgeBaseId,
      pageId,
      actor: { kind: 'human', userId: options.userId },
      occurredAt: new Date().toISOString(),
    });
  };

  const rootParent = options.parentPageId ?? null;
  const resolveParentId = (parentKey: string | null): string | null => {
    if (parentKey === null) return rootParent;
    return pageIds.get(parentKey) ?? databaseIds.get(parentKey) ?? null;
  };

  // 5) 数据库(含行):行页面复用其导出文件的身份,行正文随后单独落库。
  const handled = new Set<string>();
  const importDatabase = async (source: string, title: string, parentKey: string | null, model: NotionParsedDatabase): Promise<void> => {
    warnings.push(...model.warnings);
    const id = databaseIds.get(source) ?? pageIds.get(source)!;
    await withKnowledgeBase(options.pool, options.knowledgeBaseId, (db) => createAuthorizedDatabase(db, {
      id, knowledgeBaseId: options.knowledgeBaseId, teamspaceId: options.teamspaceId,
      parentId: resolveParentId(parentKey), title, icon: null, cover: null,
      inheritsPermissions: true, afterPageId: null, columns: model.columns,
    }, options.userId));
    databaseIds.set(source, id);
    databases.push({ source, pageId: id, title, columns: model.columns, rows: model.rows.length });
    for (const row of model.rows) {
      const rowKey = row.pageKey ? resolveNotionReference(directoryOf(source), row.pageKey) : '';
      const rowId = rowKey && pageIds.has(rowKey) ? pageIds.get(rowKey)! : randomUUID();
      if (rowKey) handled.add(rowKey);
      const rowTitle = titleOf(row.title || '未命名行');
      try {
        await withKnowledgeBase(options.pool, options.knowledgeBaseId, async (db) => {
          await createAuthorizedRow(db, {
            id: rowId, knowledgeBaseId: options.knowledgeBaseId, databaseId: id, title: rowTitle,
            icon: null, cover: null, inheritsPermissions: true, afterPageId: null, properties: row.properties,
          }, options.userId);
          const encoded = rowKey ? buildBody(rowKey) : null;
          if (encoded) await persistBody(db, rowId, encoded);
          pages.push({ source: rowKey || `${source}#row`, pageId: rowId, title: rowTitle, kind: 'row', parentId: null, databaseId: id, bodyPersisted: encoded !== null });
        });
      } catch (error) {
        failures.push({ source: rowKey || `${source}#row`, phase: 'row', message: `数据库行导入失败,已跳过该行: ${(error as Error).message}` });
      }
    }
  };

  // 6) 页面/数据库队列:目录深度即拓扑序(父页面总在子页面之前),行页面被
  //    数据库导入消费后跳过。逐项 try/catch:单项失败进入报告,不中断其余项。
  type Item = { readonly key: string; readonly kind: 'page' | 'database' };
  const queue: Item[] = [
    ...archive.pages.map((page) => ({ key: page.key, kind: 'page' as const })),
    ...archive.databases.map((database) => ({ key: database.key, kind: 'database' as const })),
  ].sort((left, right) => depthOf(left.key) - depthOf(right.key) || (left.key < right.key ? -1 : 1));

  for (const [index, item] of queue.entries()) {
    if (item.kind === 'page' && handled.has(item.key)) continue;
    try {
      if (item.kind === 'database') {
        const model = csvDatabases.get(item.key);
        if (model) await importDatabase(item.key, titles.get(item.key)!, archive.databases.find((entry) => entry.key === item.key)!.parentKey, model);
      } else {
        const page = archive.pages.find((entry) => entry.key === item.key)!;
        const info = parsed.get(item.key) ?? { title: titles.get(item.key)!, document: null, database: null };
        if (info.database) {
          await importDatabase(item.key, info.title, page.parentKey, info.database);
        } else {
          const id = pageIds.get(item.key)!;
          const parentId = resolveParentId(page.parentKey);
          const parentDatabaseId = page.parentKey !== null ? databaseIds.get(page.parentKey) ?? null : null;
          if (parentDatabaseId !== null) {
            warnings.push({ source: item.key, code: 'unsupported_element', detail: '数据库目录下不在视图表格中的页面按普通子页面导入' });
          }
          const persisted = await withKnowledgeBase(options.pool, options.knowledgeBaseId, async (db) => {
            await createAuthorizedPage(db, {
              id, knowledgeBaseId: options.knowledgeBaseId, teamspaceId: options.teamspaceId,
              parentId: parentDatabaseId ?? parentId, kind: 'doc', databaseId: null, title: info.title,
              icon: null, cover: null, properties: {}, inheritsPermissions: true, afterPageId: null,
            }, options.userId);
            const encoded = buildBody(item.key);
            if (encoded) await persistBody(db, id, encoded);
            return encoded !== null;
          });
          pages.push({ source: item.key, pageId: id, title: info.title, kind: 'doc', parentId: parentDatabaseId ?? parentId, databaseId: null, bodyPersisted: persisted });
        }
      }
    } catch (error) {
      failures.push({ source: item.key, phase: item.kind === 'database' ? 'database' : 'page', message: `导入失败,已跳过该项: ${(error as Error).message}` });
    } finally {
      progress({ phase: 'pages', completed: index + 1, total: queue.length, source: item.key });
    }
  }

  return { pages, databases, assets, warnings, failures };
}
