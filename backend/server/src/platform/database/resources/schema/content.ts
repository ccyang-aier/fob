import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, jsonb, primaryKey, text, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import type { Asset, Principal, PdfCommentAnchor } from '@fob/shared/knowledge/contracts';
import { assetDerivedSchema } from '@fob/shared/knowledge/contracts';
import { assetStatus, commentThreadStatus, commentThreadKind, commentAnchorKind } from './enums';
import { authUser } from '../../identity/schema';
import { resourcesNamespace } from './namespaces';
import { knowledgeBase } from './organization';
import { page } from './pages';
import { embeddingVector, instant } from './types';

export const blockIndex = resourcesNamespace.table('block_index', {
  // pg_search's key_field must be globally unique, unlike a page-local blockId.
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  pageId: uuid('page_id').notNull(),
  blockId: varchar('block_id', { length: 128 }).notNull(),
  blockType: varchar('block_type', { length: 60 }).notNull(),
  contentMd: text('content_md').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  /** Presentation context for short blocks: page-title path plus ancestor heading texts. */
  titlePath: text('title_path'),
  embedding: embeddingVector('embedding'),
  embedModel: text('embed_model'),
  embedDimensions: integer('embed_dimensions'),
  /** Content hash the current vector was derived from; drift marks it stale without another model call. */
  embeddedHash: varchar('embedded_hash', { length: 64 }),
  principals: text('principals').array().$type<Principal[]>().notNull().default(sql`ARRAY[]::text[]`),
  aclRevision: bigint('acl_revision', { mode: 'number' }).notNull().default(0),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  unique('block_index_knowledge_base_page_block_unique').on(table.knowledgeBaseId, table.pageId, table.blockId),
  foreignKey({ name: 'block_index_page_fk', columns: [table.knowledgeBaseId, table.pageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  check('block_index_block_id_valid', sql`${table.blockId} ~ '^[A-Za-z0-9_-]+$'`),
  check('block_index_content_hash_valid', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  check('block_index_embedding_metadata', sql`(${table.embedding} IS NULL AND ${table.embedModel} IS NULL AND ${table.embedDimensions} IS NULL AND ${table.embeddedHash} IS NULL) OR (${table.embedding} IS NOT NULL AND ${table.embedModel} IS NOT NULL AND length(${table.embedModel}) > 0 AND ${table.embedDimensions} IS NOT NULL AND ${table.embedDimensions} > 0 AND vector_dims(${table.embedding}) = ${table.embedDimensions} AND ${table.embeddedHash} IS NOT NULL AND ${table.embeddedHash} ~ '^[a-f0-9]{64}$')`),
  check('block_index_acl_revision_nonnegative', sql`${table.aclRevision} >= 0`),
  index('block_index_principals_gin_idx').using('gin', table.principals),
  index('block_index_embedding_model_idx').on(table.knowledgeBaseId, table.embedModel, table.embedDimensions),
  /**
   * H03 的 BM25 索引（§7.3）：jieba 同时切分中文与拉丁词（大小写归一）。pg_search
   * 每表仅允许一个 paradedb 索引、同一列不可配置两种分词器，ICU/stemming 无法与
   * jieba 共存于同一列；英文词干行为由检索端前缀扩展提供（search/keyword.ts）。
   */
  index('block_index_bm25_idx').using('paradedb', table.id, sql`(${table.contentMd}::pdb.jieba)`).with({ key_field: `'id'` }),
  // Per-model expression HNSW indexes are owned by H02.
]);

/** Keep active vectors readable while a replacement model is being built. */
export const blockEmbeddingStaging = resourcesNamespace.table('block_embedding_staging', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  pageId: uuid('page_id').notNull(),
  blockId: varchar('block_id', { length: 128 }).notNull(),
  embedModel: text('embed_model').notNull(),
  embedDimensions: integer('embed_dimensions').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  embedding: embeddingVector('embedding').notNull(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: 'block_embedding_staging_pk', columns: [table.knowledgeBaseId, table.pageId, table.blockId, table.embedModel, table.embedDimensions] }),
  foreignKey({ name: 'block_embedding_staging_block_fk', columns: [table.knowledgeBaseId, table.pageId, table.blockId], foreignColumns: [blockIndex.knowledgeBaseId, blockIndex.pageId, blockIndex.blockId] }).onDelete('cascade'),
  check('block_embedding_staging_hash_valid', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  check('block_embedding_staging_metadata', sql`length(${table.embedModel}) > 0 AND ${table.embedDimensions} > 0 AND vector_dims(${table.embedding}) = ${table.embedDimensions}`),
  index('block_embedding_staging_model_idx').on(table.knowledgeBaseId, table.embedModel, table.embedDimensions),
]);

/**
 * The knowledgeBase's active embedding model: exactly what H02's rebuild switch
 * promotes, and the (embed_model, embed_dimensions) retrieval filters by (§7.1).
 * Absent until the first rebuild; queries then simply have no vector leg.
 */
export const blockEmbeddingModel = resourcesNamespace.table('block_embedding_model', {
  knowledgeBaseId: uuid('knowledge_base_id').primaryKey(),
  embedModel: text('embed_model').notNull(),
  embedDimensions: integer('embed_dimensions').notNull(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: 'block_embedding_model_library_fk', columns: [table.knowledgeBaseId], foreignColumns: [knowledgeBase.id] }).onDelete('cascade'),
  check('block_embedding_model_valid', sql`length(${table.embedModel}) > 0 AND ${table.embedDimensions} > 0`),
]);

export const backlink = resourcesNamespace.table('backlink', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  srcPageId: uuid('src_page_id').notNull(),
  srcBlockId: varchar('src_block_id', { length: 128 }).notNull(),
  dstKnowledgeBaseId: uuid('dst_knowledge_base_id').notNull(),
  dstPageId: uuid('dst_page_id').notNull(),
  dstBlockId: varchar('dst_block_id', { length: 128 }),
}, (table) => [
  unique('backlink_source_target_unique').on(table.knowledgeBaseId, table.srcPageId, table.srcBlockId, table.dstKnowledgeBaseId, table.dstPageId, table.dstBlockId).nullsNotDistinct(),
  // A block need not have been indexed yet; references are to authoritative pages.
  foreignKey({ name: 'backlink_source_page_fk', columns: [table.knowledgeBaseId, table.srcPageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  foreignKey({ name: 'backlink_target_page_fk', columns: [table.dstKnowledgeBaseId, table.dstPageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  check('backlink_source_block_valid', sql`${table.srcBlockId} ~ '^[A-Za-z0-9_-]+$'`),
  check('backlink_destination_block_valid', sql`${table.dstBlockId} IS NULL OR ${table.dstBlockId} ~ '^[A-Za-z0-9_-]+$'`),
  index('backlink_destination_idx').on(table.dstKnowledgeBaseId, table.dstPageId, table.dstBlockId),
]);

export const asset = resourcesNamespace.table('asset', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull().references(() => knowledgeBase.id, { onDelete: 'cascade' }),
  hash: varchar('hash', { length: 64 }).notNull(),
  mime: varchar('mime', { length: 200 }).notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  status: assetStatus('status').notNull().default('ready'),
  meta: jsonb('meta').$type<Asset['meta']>().notNull().default({}),
  derived: jsonb('derived').$type<Asset['derived']>().notNull().default({ status: 'pending' }),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.hash] }),
  check('asset_hash_valid', sql`${table.hash} ~ '^[a-f0-9]{64}$'`),
  check('asset_size_nonnegative', sql`${table.size} >= 0`),
  check('asset_mime_valid', sql`${table.mime} ~ '^[A-Za-z0-9_.+-]+/[A-Za-z0-9_.+-]+$'`),
  check('asset_meta_object', sql`jsonb_typeof(${table.meta}) = 'object'`),
  check('asset_derived_object', sql`jsonb_typeof(${table.derived}) = 'object' AND ${table.derived}->>'status' IS NOT NULL AND ${table.derived}->>'status' IN (${sql.join(assetDerivedSchema.shape.status.options.map((status) => sql`${status}`), sql`, `)})`.inlineParams()),
]);

export const commentThread = resourcesNamespace.table('comment_thread', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  id: uuid('id').notNull(),
  pageId: uuid('page_id').notNull(),
  kind: commentThreadKind('kind').notNull().default('comment'),
  anchorKind: commentAnchorKind('anchor_kind').notNull().default('page'),
  pdfAnchor: jsonb('pdf_anchor').$type<PdfCommentAnchor>(),
  status: commentThreadStatus('status'),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'comment_thread_page_fk', columns: [table.knowledgeBaseId, table.pageId], foreignColumns: [page.knowledgeBaseId, page.id] }).onDelete('cascade'),
  index('comment_thread_page_idx').on(table.knowledgeBaseId, table.pageId, table.status),
  check('comment_thread_issue_status', sql`(${table.kind} = 'comment' AND ${table.status} IS NULL) OR (${table.kind} = 'issue' AND ${table.status} IS NOT NULL)`),
]);

export const comment = resourcesNamespace.table('comment', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  id: uuid('id').notNull(),
  threadId: uuid('thread_id').notNull(),
  authorId: uuid('author_id').notNull().references(() => authUser.id),
  replyToCommentId: uuid('reply_to_comment_id'),
  bodyMd: text('body_md').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.id] }),
  foreignKey({ name: 'comment_thread_fk', columns: [table.knowledgeBaseId, table.threadId], foreignColumns: [commentThread.knowledgeBaseId, commentThread.id] }).onDelete('cascade'),
  foreignKey({ name: 'comment_reply_target_fk', columns: [table.knowledgeBaseId, table.replyToCommentId], foreignColumns: [table.knowledgeBaseId, table.id] }),
  check('comment_body_valid', sql`length(btrim(${table.bodyMd})) BETWEEN 1 AND 50000`),
  index('comment_thread_time_idx').on(table.knowledgeBaseId, table.threadId, table.createdAt),
  index('comment_author_idx').on(table.authorId),
]);

export const commentLike = resourcesNamespace.table('comment_like', {
  knowledgeBaseId: uuid('knowledge_base_id').notNull(),
  commentId: uuid('comment_id').notNull(),
  userId: uuid('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.commentId, table.userId] }),
  foreignKey({ name: 'comment_like_comment_fk', columns: [table.knowledgeBaseId, table.commentId], foreignColumns: [comment.knowledgeBaseId, comment.id] }).onDelete('cascade'),
]);
