import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';
import { asset, docState, page } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { expandRequestPrincipals } from '../permissions/authorization';
import { effectivePageAccessCondition } from '../permissions/queries';
import type { KnowledgeAssetStorage } from '../assets/storage';
import { attachmentExtension, collectAnchorReferences, collectAssetReferences, exportVaultBody, markdownSchema } from './body';
import { KnowledgeVaultError } from './errors';
import { summarize, vaultEventRecorder } from './events';
import type { VaultEventSink, VaultItemResult, VaultProgressEvent } from './events';
import { yStateToProseMirrorDoc } from './y-encoding';
import { ATTACHMENTS_DIR, buildVaultArchive, vaultPathsForExport } from './vault';
import type { ExportVaultPage } from './vault';

/**
 * Obsidian 导出(M03 §4.4):knowledgeBase(或子树)→ zip。
 *
 * 权限:导出集 = 发起者经 P03 物化谓词(effectivePageAccessCondition,view)
 * 可见的 `doc` 页面;不可见页面连标题都不进入压缩包,导出根不可见则整体拒绝。
 * 正文经 B02 的 doc_state 权威读出,wiki/块链接锚点改写为 vault 笔记路径
 * (M02 方言:`[[路径#^blockId]]` 与 `::block-reference{pageId='路径'}`),
 * 附件经 AS01 存储逐字节下载,内容寻址命名保证再导入时哈希等价。
 */

const inputSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  userId: entityIdSchema,
  /** 限定 teamspace;缺省为整个 knowledgeBase。 */
  teamspaceId: entityIdSchema.optional(),
  /** 导出子树根;缺省为全部可见页面。 */
  rootPageId: entityIdSchema.optional(),
});

export interface VaultExportResult {
  readonly archive: Uint8Array;
  readonly transferId: string;
  readonly items: readonly VaultItemResult[];
  readonly summary: ReturnType<typeof summarize>;
  readonly events: readonly VaultProgressEvent[];
}

function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error && 'reason' in error && typeof (error as { reason: unknown }).reason === 'string'
    ? (error as { reason: string }).reason
    : fallback;
}

async function readAll(response: Response): Promise<Uint8Array> {
  const body = response.body;
  if (!body) throw new KnowledgeVaultError('VAULT_STORAGE_FAILED', '附件对象没有响应体');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function exportObsidianVault(deps: { pool: Pool; storage: KnowledgeAssetStorage; onEvent?: VaultEventSink }, input: unknown): Promise<VaultExportResult> {
  const parsed = inputSchema.parse(input);
  const transferId = randomUUID();
  const recorder = vaultEventRecorder(transferId, 'export', deps.onEvent);
  const items: VaultItemResult[] = [];

  recorder.phase('planning', 0, 0);
  const visible = await withKnowledgeBase(deps.pool, parsed.knowledgeBaseId, async (db) => {
    const principals = await expandRequestPrincipals(db, parsed.knowledgeBaseId, parsed.userId);
    if (!principals.length) throw new KnowledgeVaultError('VAULT_ACCESS_DENIED', '发起者不是知识库成员');
    const conditions = [eq(page.knowledgeBaseId, parsed.knowledgeBaseId), isNull(page.deletedAt), eq(page.kind, 'doc'),
      effectivePageAccessCondition({ knowledgeBaseId: parsed.knowledgeBaseId, principals, required: 'view' })];
    if (parsed.teamspaceId) conditions.push(eq(page.teamspaceId, parsed.teamspaceId));
    if (parsed.rootPageId) {
      const [root] = await db.select({ path: page.path }).from(page)
        .where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.id, parsed.rootPageId)));
      if (!root) throw new KnowledgeVaultError('VAULT_ACCESS_DENIED', '导出根不存在');
      conditions.push(sql`${page.path} <@ ${root.path}::ltree`);
    }
    const rows = await db.select({
      id: page.id, title: page.title, parentId: page.parentId, properties: page.properties, icon: page.icon, path: page.path,
    }).from(page).where(and(...conditions)).orderBy(asc(page.path));
    return rows;
  });

  if (parsed.rootPageId && !visible.some((row) => row.id === parsed.rootPageId)) {
    throw new KnowledgeVaultError('VAULT_ACCESS_DENIED', '发起者看不到导出根');
  }
  if (!visible.length) throw new KnowledgeVaultError('VAULT_TREE_INVALID', '没有可导出的页面');

  const vaultPaths = vaultPathsForExport(visible.map(({ id, title, parentId }) => ({ id, title, parentId })));
  const noteOf = (pageId: string) => `${vaultPaths.get(pageId) ?? pageId}.md`;

  const states = new Map<string, Uint8Array>();
  await withKnowledgeBase(deps.pool, parsed.knowledgeBaseId, async (db) => {
    const rows = await db.select({ pageId: docState.pageId, state: docState.state }).from(docState)
      .where(and(eq(docState.knowledgeBaseId, parsed.knowledgeBaseId), inArray(docState.pageId, visible.map((row) => row.id))));
    for (const row of rows) states.set(row.pageId, new Uint8Array(row.state));
  });

  // 正文解码一次;解码失败或引用缺失资产的页面逐项失败,不阻塞其余页面。
  interface Planned { row: (typeof visible)[number]; document: ProseMirrorNode | null; hashes: string[]; failure?: string }
  const planned: Planned[] = [];
  for (const row of visible) {
    const state = states.get(row.id);
    let document: ProseMirrorNode | null = null;
    let failure: string | undefined;
    try {
      if (state) document = yStateToProseMirrorDoc(state, markdownSchema());
    } catch (cause) {
      failure = 'body_unreadable';
      void cause;
    }
    planned.push({ row, document, hashes: document ? collectAssetReferences(document) : [], failure });
  }

  const anchors = new Set(planned.flatMap((entry) => (entry.document ? collectAnchorReferences(entry.document) : [])));
  const allHashes = [...new Set(planned.flatMap((entry) => entry.hashes))];
  const assetRows = allHashes.length
    ? await withKnowledgeBase(deps.pool, parsed.knowledgeBaseId, (db) => db
      .select({ hash: asset.hash, mime: asset.mime, status: asset.status })
      .from(asset).where(and(eq(asset.knowledgeBaseId, parsed.knowledgeBaseId), inArray(asset.hash, allHashes))))
    : [];
  const readyAssets = new Map(assetRows.filter((row) => row.status === 'ready').map((row) => [row.hash, row]));
  const mimeOf = (hash: string) => readyAssets.get(hash)?.mime ?? 'application/octet-stream';

  const attachmentBytes = new Map<string, Uint8Array>();
  let done = 0;
  for (const hash of allHashes) {
    const path = `${ATTACHMENTS_DIR}/${hash}.${attachmentExtension(mimeOf(hash))}`;
    if (!readyAssets.has(hash)) {
      items.push({ kind: 'attachment', path, status: 'failed', reason: 'asset_not_ready' });
    } else {
      try {
        const response = await deps.storage.openObject({ knowledgeBaseId: parsed.knowledgeBaseId, hash });
        attachmentBytes.set(hash, await readAll(response));
        items.push({ kind: 'attachment', path, status: 'exported' });
      } catch {
        items.push({ kind: 'attachment', path, status: 'failed', reason: 'asset_not_ready' });
      }
    }
    done += 1;
    recorder.phase('attachments', done, allHashes.length);
  }

  const exportPages: ExportVaultPage[] = [];
  const exportAttachments = [...attachmentBytes].map(([hash, bytes]) => ({
    path: `${ATTACHMENTS_DIR}/${hash}.${attachmentExtension(mimeOf(hash))}`,
    bytes,
  }));

  done = 0;
  for (const entry of planned) {
    const note = noteOf(entry.row.id);
    const blockingAssets = entry.hashes.filter((hash) => !attachmentBytes.has(hash));
    try {
      if (entry.failure) throw new Error(entry.failure);
      if (blockingAssets.length) throw new Error('asset_not_ready');
      const markdown = entry.document
        ? exportVaultBody(entry.document, {
          knowledgeBaseId: parsed.knowledgeBaseId,
          vaultPathOf: (pageId) => vaultPaths.get(pageId),
          attachmentPathOf: (hash) => `${ATTACHMENTS_DIR}/${hash}.${attachmentExtension(mimeOf(hash))}`,
          anchoredBlockIds: anchors,
        })
        : '';
      exportPages.push({ id: entry.row.id, title: entry.row.title, parentId: entry.row.parentId, properties: entry.row.properties, icon: entry.row.icon, markdown });
      items.push({ kind: 'page', path: note, pageId: entry.row.id, status: 'exported' });
    } catch (cause) {
      items.push({ kind: 'page', path: note, status: 'failed', reason: reasonOf(cause, 'export_failed') });
    }
    done += 1;
    recorder.phase('pages', done, planned.length, { path: note, status: 'ok' });
  }

  recorder.phase('packaging', exportPages.length, exportPages.length);
  const archive = buildVaultArchive(exportPages, exportAttachments);
  recorder.phase('done', exportPages.length, exportPages.length);
  return { archive, transferId, items, summary: summarize(items), events: recorder.timeline };
}
