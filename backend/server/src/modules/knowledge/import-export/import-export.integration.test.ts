import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { unzipSync, zipSync } from 'fflate';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { OutboxEvent } from '@fob/shared/knowledge/contracts';
import { knowledgeBase, resourceSchema, member, teamspace } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import { createResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import type { KnowledgeAssetStorage } from '../assets/storage';
import { createKnowledgeAssetStorage, readKnowledgeAssetStorageConfig } from '../assets/storage';
import { createAuthorizedPage } from '../pages/tree';
import { rebuildPermissionSubtree } from '../permissions/rebuild';
import { initializeKnowledgeJobs } from '../workers/initialize';
import { markdownSchema } from './body';
import { vaultProgressEventSchema } from './events';
import { exportObsidianVault } from './export';
import { importObsidianVault } from './import';
import { parseVaultArchive } from './vault';
import { yStateToProseMirrorDoc } from './y-encoding';

/**
 * M03 Obsidian 仓库导入导出集成验收:真实 ParadeDB(RLS)+ 真实 MinIO。
 * 覆盖:目录树→页面树、附件经 AS01 入湖、frontmatter→页面属性、
 * wiki/块链接往返、进度事件、逐项失败、幂等重放与导出再导入的往返不动点。
 */

const encoder = new TextEncoder();
const zip = (entries: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, typeof value === 'string' ? encoder.encode(value) : value])));

const PHOTO = encoder.encode('M03 photo bytes 知识库附件');
const PHOTO_HASH = createHash('sha256').update(PHOTO).digest('hex');
const SPEC = encoder.encode('M03 spec pdf bytes');
const SPEC_HASH = createHash('sha256').update(SPEC).digest('hex');

const TARGET_TITLE = '基地';

const vaultArchive = () => zip({
  'Welcome.md': '---\nicon: 🌍\ntags:\n  - m03\n  - vault\n---\n入口页。参见 [[Projects/roadmap|路线图]] 与 [[Ghost]]。\n',
  'Projects.md': '项目根。\n',
  'Projects/roadmap.md': '路线图正文。\n\n![[assets/photo.png|架构图]]\n\n![[Projects#^anchor1]]\n\n![[Projects]]\n\n![[assets/report.pdf]]\n',
  'assets/photo.png': PHOTO,
  'assets/report.pdf': SPEC,
});

let database: ResourceTestDatabase;
let storage: KnowledgeAssetStorage;
const owner = { knowledgeBaseId: randomUUID(), userId: randomUUID() };
const outsider = randomUUID();
const teamspaceId = randomUUID();
const targetA = randomUUID();
const targetB = randomUUID();
const targetC = randomUUID();
let mainTransferId = '';
const uploadedObjects: { knowledgeBaseId: string; hash: string }[] = [];

async function rows<T extends Record<string, unknown>>(query: string, values: unknown[] = []): Promise<T[]> {
  return (await database.admin.query(query, values)).rows as T[];
}

type AclEvent = Extract<OutboxEvent, { topic: 'acl.changed' }>;

/** P02 消费者语义:取每个根的最新 revision 做当前态重建,物化有效权限。 */
async function materializePermissions() {
  const events = await rows<{ payload: AclEvent }>(
    `SELECT DISTINCT ON (payload->>'rootPageId') payload FROM resources.outbox
     WHERE knowledge_base_id=$1 AND topic='acl.changed' ORDER BY payload->>'rootPageId', (payload->>'revision')::bigint DESC`,
    [owner.knowledgeBaseId],
  );
  for (const { payload } of events) {
    await withKnowledgeBase(database.pool, owner.knowledgeBaseId, (db) => rebuildPermissionSubtree(db, payload));
  }
}

async function pageRow(pageId: string) {
  const [row] = await rows<{ id: string; parent_id: string | null; title: string; icon: string | null; properties: Record<string, unknown>; teamspace_id: string }>(
    'SELECT id::text, parent_id::text AS parent_id, title, icon, properties, teamspace_id::text AS teamspace_id FROM resources.page WHERE knowledge_base_id=$1 AND id=$2',
    [owner.knowledgeBaseId, pageId],
  );
  return row;
}

async function pageBody(pageId: string): Promise<ProseMirrorNode | null> {
  const [row] = await rows<{ state: Buffer }>('SELECT state FROM resources.doc_state WHERE knowledge_base_id=$1 AND page_id=$2', [owner.knowledgeBaseId, pageId]);
  return row ? yStateToProseMirrorDoc(new Uint8Array(row.state), markdownSchema()) : null;
}

function blockTypes(document: ProseMirrorNode): string[] {
  const types: string[] = [];
  const walk = (node: ProseMirrorNode): void => {
    types.push(node.type.name);
    node.forEach(walk);
  };
  document.forEach(walk);
  return types;
}

const importVault = (archive: Uint8Array, input: { transferId?: string; userId?: string; parentPageId?: string } = {}) =>
  importObsidianVault({ pool: database.pool, storage }, {
    knowledgeBaseId: owner.knowledgeBaseId,
    userId: input.userId ?? owner.userId,
    parentPageId: input.parentPageId ?? targetA,
    archive,
    ...(input.transferId ? { transferId: input.transferId } : {}),
  });
const exportVault = (input: { userId?: string; rootPageId?: string } = {}) =>
  exportObsidianVault({ pool: database.pool, storage }, {
    knowledgeBaseId: owner.knowledgeBaseId,
    userId: input.userId ?? owner.userId,
    ...(input.rootPageId ? { rootPageId: input.rootPageId } : {}),
  });

beforeAll(async () => {
  storage = createKnowledgeAssetStorage(await readKnowledgeAssetStorageConfig());
  database = await createResourceTestDatabase();
  await initializeKnowledgeJobs(database.admin, database.pool);
  const client = await database.admin.connect();
  try {
    await client.query('BEGIN');
    const db = drizzle(client, { schema: resourceSchema });
    await db.insert(authUser).values([
      { id: owner.userId, name: 'M03 Owner', email: `${owner.userId}@m03.test` },
      { id: outsider, name: 'M03 Outsider', email: `${outsider}@m03.test` },
    ]);
    await db.insert(knowledgeBase).values({ id: owner.knowledgeBaseId, name: 'M03 Vault' });
    await db.insert(member).values({ knowledgeBaseId: owner.knowledgeBaseId, userId: owner.userId, role: 'owner' });

    await db.insert(teamspace).values({ knowledgeBaseId: owner.knowledgeBaseId, id: teamspaceId, name: 'Main', defaultAccess: 'edit' });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await withKnowledgeBase(database.pool, owner.knowledgeBaseId, async (db) => {
    const targets: [string, string][] = [[targetA, TARGET_TITLE], [targetB, TARGET_TITLE], [targetC, '失败样本']];
    for (const [id, title] of targets) {
      await createAuthorizedPage(db, { id, knowledgeBaseId: owner.knowledgeBaseId, teamspaceId, parentId: null, kind: 'doc', databaseId: null, title, icon: null, cover: null, properties: {}, inheritsPermissions: true, afterPageId: null }, owner.userId);
    }
  });
  await materializePermissions();
}, 120_000);

afterAll(async () => {
  for (const object of uploadedObjects) await storage.deleteObject(object).catch(() => undefined);
  expect(database.idleErrors).toEqual([]);
  await database.dispose();
}, 60_000);

describe('M03 importObsidianVault: tree, attachments, frontmatter and progress', () => {
  test('imports a multi-page vault with directories, frontmatter, wikilinks, embeds and attachments', async () => {
    const result = await importVault(vaultArchive());
    mainTransferId = result.transferId;
    expect(result.summary).toEqual({ pagesDone: 3, pagesFailed: 0, attachmentsDone: 2, attachmentsFailed: 0 });

    for (const event of result.events) expect(vaultProgressEventSchema.parse(event)).toBeDefined();
    const phases = [...new Set(result.events.map((event) => event.phase))];
    expect(phases).toEqual(['planning', 'attachments', 'pages', 'done']);
    for (const phase of ['attachments', 'pages'] as const) {
      const done = result.events.filter((event) => event.phase === phase).map((event) => event.done);
      expect(done).toEqual(done.map((_, index) => index + 1));
    }

    const byPath = new Map(result.items.map((item) => [item.path, item]));
    const projects = byPath.get('Projects.md');
    const roadmap = byPath.get('Projects/roadmap.md');
    const welcome = byPath.get('Welcome.md');
    expect(projects?.status).toBe('imported');
    expect(projects?.pageId).toBeDefined();
    uploadedObjects.push({ knowledgeBaseId: owner.knowledgeBaseId, hash: PHOTO_HASH }, { knowledgeBaseId: owner.knowledgeBaseId, hash: SPEC_HASH });

    // 目录树 → 页面树:roadmap 挂 Projects 下,其余挂导入目标下。
    const projectsRow = await pageRow(projects!.pageId!);
    const roadmapRow = await pageRow(roadmap!.pageId!);
    const welcomeRow = await pageRow(welcome!.pageId!);
    expect(projectsRow).toMatchObject({ parent_id: targetA, title: 'Projects', icon: null, teamspace_id: teamspaceId });
    expect(roadmapRow).toMatchObject({ parent_id: projects!.pageId!, title: 'roadmap', teamspace_id: teamspaceId });
    expect(welcomeRow).toMatchObject({ parent_id: targetA, title: 'Welcome', icon: '🌍', properties: { tags: ['m03', 'vault'] } });

    // 附件经 AS01 完整流程入湖。
    const [asset] = await rows<{ status: string; mime: string; size: string }>(
      'SELECT status, mime, size::text FROM resources.asset WHERE knowledge_base_id=$1 AND hash=$2', [owner.knowledgeBaseId, PHOTO_HASH]);
    expect(asset).toMatchObject({ status: 'ready', mime: 'image/png', size: String(PHOTO.byteLength) });

    // 正文以 Y.Doc 初始状态写入 doc_state,可解码回知识文档。
    const roadmapDoc = await pageBody(roadmap!.pageId!);
    expect(roadmapDoc).not.toBeNull();
    const types = blockTypes(roadmapDoc!);
    for (const expected of ['image', 'blockReference', 'pageLink', 'file']) expect(types).toContain(expected);
    const welcomeDoc = await pageBody(welcome!.pageId!);
    const wikiLinks = blockTypes(welcomeDoc!).filter((type) => type === 'wikiLink');
    expect(wikiLinks.length).toBe(2);

    const docChanged = await rows<{ count: string }>(
      "SELECT count(*)::text AS count FROM resources.outbox WHERE knowledge_base_id=$1 AND topic='doc.changed'", [owner.knowledgeBaseId]);
    expect(Number(docChanged[0]!.count)).toBeGreaterThanOrEqual(3);
  });

  test('replaying the same transferId is idempotent: no duplicated pages, no duplicated assets', async () => {
    const first = { transferId: mainTransferId, items: await importVault(vaultArchive(), { transferId: mainTransferId }).then((outcome) => outcome.items) };
    const second = await importVault(vaultArchive(), { transferId: mainTransferId });
    expect(second.transferId).toBe(mainTransferId);
    const pageIds = new Set(second.items.filter((item) => item.kind === 'page').map((item) => item.pageId));
    expect(pageIds.size).toBe(3);
    for (const item of first.items.filter((entry) => entry.kind === 'page')) {
      expect(second.items).toContainEqual(item);
    }
    const count = await rows<{ count: string }>(
      'SELECT count(*)::text AS count FROM resources.page WHERE knowledge_base_id=$1 AND parent_id=$2 AND deleted_at IS NULL',
      [owner.knowledgeBaseId, targetA]);
    expect(Number(count[0]!.count)).toBe(2); // Welcome 与 Projects;roadmap 挂在 Projects 下
  });

  test('per-item failures do not block healthy pages and carry structured reasons', async () => {
    const result = await importVault(zip({
      'good.md': '好页面',
      'binary.md': new Uint8Array([0xff, 0xfe, 0xfd]),
      'bad-frontmatter.md': '---\n"date created": 2026-01-01\n---\n正文',
      'missing-attachment.md': '![](ghost.png)',
    }), { parentPageId: targetC });
    expect(result.summary).toEqual({ pagesDone: 1, pagesFailed: 3, attachmentsDone: 0, attachmentsFailed: 0 });
    const reasons = new Map(result.items.map((item) => [item.path, item.reason]));
    expect(reasons.get('binary.md')).toBe('page_not_utf8');
    expect(reasons.get('bad-frontmatter.md')).toBe('frontmatter_property_id');
    expect(reasons.get('missing-attachment.md')).toBe('attachment_missing');
    expect(result.items.find((item) => item.path === 'good.md')).toMatchObject({ status: 'imported' });
    const failedEvents = result.events.filter((event) => event.item?.status === 'failed');
    expect(failedEvents.map((event) => event.item!.reason).sort()).toEqual(['attachment_missing', 'frontmatter_property_id', 'page_not_utf8']);
  });

  test('refuses outsiders, broken archives and empty vaults without side effects', async () => {
    await expect(importVault(vaultArchive(), { userId: outsider })).rejects.toMatchObject({ code: 'VAULT_ACCESS_DENIED' });
    await expect(importVault(encoder.encode('不是zip'))).rejects.toMatchObject({ code: 'VAULT_ARCHIVE_INVALID' });
    await expect(importVault(zip({ '.obsidian/app.json': '{}' }))).rejects.toMatchObject({ code: 'VAULT_ARCHIVE_INVALID' });
  });
});

describe('M03 exportObsidianVault: visible pages back to an Obsidian archive', () => {
  test('exports the imported subtree and passes the onEvent sink through', async () => {
    await materializePermissions();
    const seen: unknown[] = [];
    const result = await exportObsidianVault({ pool: database.pool, storage, onEvent: (event) => seen.push(event) }, {
      knowledgeBaseId: owner.knowledgeBaseId, userId: owner.userId, rootPageId: targetA,
    });
    for (const event of result.events) expect(vaultProgressEventSchema.parse(event)).toBeDefined();
    expect(seen.length).toBe(result.events.length);

    const { vault, failures } = parseVaultArchive(result.archive);
    expect(failures).toEqual([]);
    const noteOf = new Map(vault.pages.map((note) => [note.path, note]));
    expect([...noteOf.keys()].sort()).toEqual([TARGET_TITLE, `${TARGET_TITLE}/Projects`, `${TARGET_TITLE}/Projects/roadmap`, `${TARGET_TITLE}/Welcome`]);
    const welcomeNote = noteOf.get(`${TARGET_TITLE}/Welcome`)!;
    expect(welcomeNote.icon).toBe('🌍');
    expect(welcomeNote.properties).toEqual({ tags: ['m03', 'vault'] });
    expect(welcomeNote.markdown).toContain(`[[${TARGET_TITLE}/Projects/roadmap|路线图]]`);
    expect(welcomeNote.markdown).toContain('[[Ghost]]');
    const roadmapNote = noteOf.get(`${TARGET_TITLE}/Projects/roadmap`)!;
    expect(roadmapNote.markdown).toContain(`::block-reference{pageId='${TARGET_TITLE}/Projects' targetBlockId='anchor1'`);
    expect(roadmapNote.markdown).toContain(`_attachments/${PHOTO_HASH}.png`);
    expect(roadmapNote.markdown).toContain(`_attachments/${SPEC_HASH}.pdf`);
    const attachments = new Map(vault.attachments.map((attachment) => [attachment.path.split('/').at(-1)!, attachment.bytes]));
    expect(attachments.get(`${PHOTO_HASH}.png`)).toEqual(PHOTO);
    expect(attachments.get(`${SPEC_HASH}.pdf`)).toEqual(SPEC);
  });

  test('re-importing the exported archive reaches a round-trip fixed point', async () => {
    const first = await exportVault({ rootPageId: targetA });
    await materializePermissions();

    // 顶层目标页不随包迁移;其余页面原样再导入到目标 B。
    const entries = unzipSync(first.archive);
    delete entries[`${TARGET_TITLE}.md`];
    const repack = zipSync(entries);
    const reimport = await importVault(repack, { parentPageId: targetB });
    expect(reimport.summary).toEqual({ pagesDone: 3, pagesFailed: 0, attachmentsDone: 2, attachmentsFailed: 0 });

    await materializePermissions();
    const second = await exportVault({ rootPageId: targetB });
    const left = new Map(parseVaultArchive(first.archive).vault.pages.map((note) => [note.path, note]));
    const right = new Map(parseVaultArchive(second.archive).vault.pages.map((note) => [note.path, note]));
    expect([...left.keys()].sort()).toEqual([...right.keys()].sort());
    for (const [path, note] of left) {
      expect(right.get(path)?.markdown).toBe(note.markdown);
      expect(right.get(path)?.icon).toBe(note.icon);
      expect(right.get(path)?.properties).toEqual(note.properties);
    }
  });

  test('outsiders see neither the whole knowledgeBase nor a subtree', async () => {
    await expect(exportVault({ userId: outsider })).rejects.toMatchObject({ code: 'VAULT_ACCESS_DENIED' });
    await expect(exportVault({ userId: outsider, rootPageId: targetA })).rejects.toMatchObject({ code: 'VAULT_ACCESS_DENIED' });
  });

  test('an unknown export root is refused', async () => {
    await expect(exportVault({ rootPageId: randomUUID() })).rejects.toMatchObject({ code: 'VAULT_ACCESS_DENIED' });
  });
});
