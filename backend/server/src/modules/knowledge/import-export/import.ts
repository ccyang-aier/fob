import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { z } from 'zod';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';
import { docState, page } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { prepareKnowledgeBaseAssetUpload, confirmKnowledgeBaseAssetUpload } from '../assets/service';
import type { KnowledgeAssetStorage } from '../assets/storage';
import { authorizePageAccess } from '../permissions/authorization';
import { createAuthorizedPage } from '../pages/tree';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { bindImportedReferenceKnowledgeBase, createVaultResolver, importVaultBody } from './body';
import { KnowledgeVaultError } from './errors';
import { summarize, vaultEventRecorder } from './events';
import type { VaultEventSink, VaultItemResult, VaultProgressEvent } from './events';
import { parseVaultArchive, parentPathOf } from './vault';
import { prosemirrorDocToYDoc } from './y-encoding';

/**
 * Obsidian 导入(M03 §4.4):zip → 页面树 + 正文 + 附件。
 *
 * 权限:以发起者身份执行。目标父页面先经 P03 authorizePageAccess 校验
 * edit;页面创建走 T01 的幂等 UUID 语义(pageId 由 transferId+vault 路径
 * 确定性推导,同 transferId 重放不产生重复页面)。附件按 AS01 的完整流程
 * (prepare → 预签名 PUT → confirm 校验)入湖,正文以 Y.Doc 初始状态写入
 * B02 的 doc_state 并发 doc.changed(actor=发起者),不在任何旁路表落正文。
 *
 * 逐项失败:frontmatter/编码/正文不合规的页面、解析或确认失败的附件只
 * 记录失败项,不中断整体;引用缺失附件的页面照此失败。汇总报告含全部事件。
 */

const inputSchema = z.strictObject({
  knowledgeBaseId: entityIdSchema,
  userId: entityIdSchema,
  /** 导入目标父页面(页面挂在其下;vault 根级笔记成为其子页面)。 */
  parentPageId: entityIdSchema,
  archive: z.instanceof(Uint8Array),
  /** 重放同一 transferId 幂等(页面 id 由它推导);缺省每次全新。 */
  transferId: entityIdSchema.optional(),
});

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export interface VaultImportResult {
  readonly transferId: string;
  readonly items: readonly VaultItemResult[];
  readonly summary: ReturnType<typeof summarize>;
  readonly events: readonly VaultProgressEvent[];
}

/** sha256(transferId, vault 路径) 截成 UUID 形状(版本 8,自定义)。 */
function pageIdFor(transferId: string, vaultPath: string): string {
  const digest = createHash('sha256').update(`${transferId}\n${vaultPath}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', weba: 'audio/webm', m4a: 'audio/mp4',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
};

/** 附件声明 mime:按扩展名;未知扩展一律 octet-stream(AS01 confirm 以实际写入为准)。 */
export function mimeOfAttachment(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  return EXTENSION_MIME[extension] ?? 'application/octet-stream';
}

/** AS01 流程:prepare(租户事务)→ 预签名 PUT(无事务)→ confirm(新事务)。 */
async function uploadAttachment(storage: KnowledgeAssetStorage, pool: Pool, input: { knowledgeBaseId: string; userId: string }, attachment: { path: string; bytes: Uint8Array; mime: string; hash: string }) {
  const intent = { knowledgeBaseId: input.knowledgeBaseId, userId: input.userId, hash: attachment.hash, mime: attachment.mime, size: attachment.bytes.byteLength, name: attachment.path.split('/').at(-1)! };
  const prepared = await withKnowledgeBase(pool, input.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, intent));
  if (prepared.action === 'upload') {
    const response = await fetch(prepared.url, { method: 'PUT', headers: prepared.headers, body: attachment.bytes });
    if (!response.ok) throw new Error(`asset_upload_http_${response.status}`);
  }
  await withKnowledgeBase(pool, input.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, intent));
}

export async function importObsidianVault(deps: { pool: Pool; storage: KnowledgeAssetStorage; onEvent?: VaultEventSink }, input: unknown): Promise<VaultImportResult> {
  const parsed = inputSchema.parse(input);
  if (parsed.archive.byteLength === 0 || parsed.archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new KnowledgeVaultError('VAULT_ARCHIVE_INVALID', `压缩包大小必须在 1..${MAX_ARCHIVE_BYTES} 字节`);
  }
  const transferId = parsed.transferId ?? randomUUID();
  const recorder = vaultEventRecorder(transferId, 'import', deps.onEvent);
  const items: VaultItemResult[] = [];

  // 目标父页面:P03 edit 校验 + 读取落位信息(teamspace 以父页面为准)。
  const target = await withKnowledgeBase(deps.pool, parsed.knowledgeBaseId, async (db) => {
    const decision = await authorizePageAccess(db, { userId: parsed.userId, scope: { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.parentPageId }, required: 'edit' });
    if (decision.decision !== 'allow') throw new KnowledgeVaultError('VAULT_ACCESS_DENIED', '发起者对导入目标没有编辑权限');
    const [parent] = await db.select({ id: page.id, teamspaceId: page.teamspaceId }).from(page)
      .where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.id, parsed.parentPageId)));
    if (!parent) throw new KnowledgeVaultError('VAULT_TARGET_INVALID', '导入目标父页面不存在');
    return parent;
  });

  recorder.phase('planning', 0, 0);
  const parsedVault = parseVaultArchive(parsed.archive);
  for (const [index, failure] of parsedVault.failures.entries()) {
    items.push({ kind: 'page', path: failure.path, status: 'failed', reason: failure.reason });
    recorder.fail('planning', index + 1, parsedVault.failures.length, failure.path, failure.reason);
  }
  const vault = parsedVault.vault;
  if (!vault.pages.length && !vault.attachments.length) throw new KnowledgeVaultError('VAULT_ARCHIVE_INVALID', '压缩包内没有可导入的页面或附件');

  // 页面树:父页面 = 最长祖先笔记;按路径排序即父先于子。
  const pagePaths = new Set(vault.pages.map((entry) => entry.path));
  const parentIdOf = new Map<string, string | null>();
  for (const entry of vault.pages) {
    const ancestor = parentPathOf(entry.path, pagePaths);
    parentIdOf.set(entry.path, ancestor === null ? target.id : pageIdFor(transferId, ancestor));
  }
  const ordered = [...vault.pages].sort((left, right) => left.path.localeCompare(right.path));
  const plannedPages = ordered.map((entry) => ({ ...entry, pageId: pageIdFor(transferId, entry.path) }));

  // 附件:AS01 完整流程;失败项记录,引用它的页面随后失败。
  const attachmentHashes = vault.attachments.map((attachment) => ({ ...attachment, hash: createHash('sha256').update(attachment.bytes).digest('hex'), mime: mimeOfAttachment(attachment.path) }));
  const confirmed = new Map<string, { hash: string; mime: string }>();
  let done = 0;
  for (const attachment of attachmentHashes) {
    try {
      await uploadAttachment(deps.storage, deps.pool, parsed, attachment);
      confirmed.set(attachment.path, { hash: attachment.hash, mime: attachment.mime });
      items.push({ kind: 'attachment', path: attachment.path, status: 'imported' });
    } catch {
      items.push({ kind: 'attachment', path: attachment.path, status: 'failed', reason: 'asset_upload_failed' });
    }
    done += 1;
    recorder.phase('attachments', done, attachmentHashes.length, { path: attachment.path, status: confirmed.has(attachment.path) ? 'ok' : 'failed' });
  }

  const createdPages = plannedPages.map((entry) => ({ path: entry.path, pageId: entry.pageId }));
  const resolver = createVaultResolver(createdPages, [...confirmed].map(([path, asset]) => ({ path, hash: asset.hash, mime: asset.mime })));

  // 页面:建页(T01 幂等)+ 正文(Y.Doc 初始状态 → doc_state + doc.changed)同事务。
  done = 0;
  for (const entry of plannedPages) {
    try {
      const document = bindImportedReferenceKnowledgeBase(importVaultBody(entry.markdown, entry.path, resolver), parsed.knowledgeBaseId);
      const encoded = prosemirrorDocToYDoc(document);
      await withKnowledgeBase(deps.pool, parsed.knowledgeBaseId, async (db) => {
        await createAuthorizedPage(db, {
          id: entry.pageId,
          knowledgeBaseId: parsed.knowledgeBaseId,
          teamspaceId: target.teamspaceId,
          parentId: parentIdOf.get(entry.path)!,
          kind: 'doc',
          databaseId: null,
          title: entry.title,
          icon: entry.icon,
          cover: null,
          properties: entry.properties,
          inheritsPermissions: true,
          afterPageId: null,
        }, parsed.userId);
        await db.insert(docState).values({ knowledgeBaseId: parsed.knowledgeBaseId, pageId: entry.pageId, state: Buffer.from(encoded.state), stateVector: Buffer.from(encoded.stateVector) })
          .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state: Buffer.from(encoded.state), stateVector: Buffer.from(encoded.stateVector) } });
        await appendKnowledgeOutbox(db, {
          topic: 'doc.changed', knowledgeBaseId: parsed.knowledgeBaseId, pageId: entry.pageId,
          actor: { kind: 'human', userId: parsed.userId }, occurredAt: new Date().toISOString(),
        });
      });
      items.push({ kind: 'page', path: `${entry.path}.md`, pageId: entry.pageId, status: 'imported' });
      recorder.phase('pages', done + 1, plannedPages.length, { path: `${entry.path}.md`, status: 'ok' });
    } catch (cause) {
      const reason = cause instanceof Error && 'reason' in cause && typeof (cause as { reason: unknown }).reason === 'string'
        ? (cause as { reason: string }).reason
        : cause instanceof Error && cause.name === 'KnowledgePageError' ? 'page_create_failed'
          : cause instanceof Error && cause.name === 'KnowledgeMarkdownError' ? 'markdown_invalid' : 'import_failed';
      items.push({ kind: 'page', path: `${entry.path}.md`, status: 'failed', reason });
      recorder.fail('pages', done + 1, plannedPages.length, `${entry.path}.md`, reason);
    }
    done += 1;
  }

  recorder.phase('done', done, plannedPages.length);
  return { transferId, items, summary: summarize(items), events: recorder.timeline };
}
