import { z } from 'zod';
import { assetHashSchema, blockIdSchema, entityIdSchema, pageScopeSchema, timestampSchema, knowledgeBaseScopeSchema } from './primitives';

export const blockReferenceSchema = pageScopeSchema.extend({ blockId: blockIdSchema });
export const citationSchema = blockReferenceSchema.extend({ pageTitle: z.string(), excerpt: z.string() });
export const searchInputSchema = knowledgeBaseScopeSchema.extend({
  query: z.string().trim().min(1).max(4000),
  filters: z.strictObject({
    teamspaceId: entityIdSchema.optional(),
    pageIds: z.array(entityIdSchema).max(100).optional(),
    blockTypes: z.array(z.string().min(1).max(60)).max(30).optional(),
  }).default({}),
  limit: z.number().int().min(1).max(20).default(20),
});
export const searchHitSchema = citationSchema.extend({ score: z.number().finite(), contentMd: z.string(), blockType: z.string() });
export const readPageInputSchema = pageScopeSchema.extend({ range: z.array(blockIdSchema).min(1).max(100).optional() });
export const blockWriteInputSchema = pageScopeSchema.extend({ markdown: z.string().min(1).max(1_000_000) });
export const insertBlocksInputSchema = blockWriteInputSchema.extend({ afterBlockId: blockIdSchema.nullable() });
export const replaceBlocksInputSchema = blockWriteInputSchema.extend({ blockIds: z.array(blockIdSchema).min(1).max(1000) });
export const deleteBlocksInputSchema = pageScopeSchema.extend({ blockIds: z.array(blockIdSchema).min(1).max(1000) });

export const commentThreadKindSchema = z.enum(['comment', 'issue']);
export const commentAnchorKindSchema = z.enum(['page', 'selection']);
/** Coordinates are relative to each unrotated PDF page, independent of zoom. */
export const pdfCommentAnchorSchema = z.strictObject({
  assetHash: assetHashSchema,
  quote: z.string().trim().min(1).max(50_000),
  pages: z.array(z.strictObject({
    page: z.number().int().min(1).max(100_000),
    rects: z.array(z.strictObject({
      x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1),
      width: z.number().finite().positive().max(1), height: z.number().finite().positive().max(1),
    }).refine(rect => rect.x + rect.width <= 1.00001 && rect.y + rect.height <= 1.00001)).min(1).max(200),
  })).min(1).max(32),
}).refine(anchor => new Set(anchor.pages.map(item => item.page)).size === anchor.pages.length);
export type PdfCommentAnchor = z.infer<typeof pdfCommentAnchorSchema>;
export const commentThreadStatusSchema = z.enum(['open', 'resolved']);
export const commentThreadSchema = pageScopeSchema.extend({
  id: entityIdSchema, kind: commentThreadKindSchema, anchorKind: commentAnchorKindSchema,
  pdfAnchor: pdfCommentAnchorSchema.optional(),
  status: commentThreadStatusSchema.nullable(), createdAt: timestampSchema,
}).refine(thread => (thread.kind === 'issue' ? thread.status !== null : thread.status === null) && (!thread.pdfAnchor || thread.anchorKind === 'selection'));
export const commentSchema = knowledgeBaseScopeSchema.extend({
  id: entityIdSchema, threadId: entityIdSchema, authorId: entityIdSchema,
  replyToCommentId: entityIdSchema.nullable(),
  bodyMd: z.string().trim().min(1).max(50_000), createdAt: timestampSchema, updatedAt: timestampSchema,
});
export const checkpointSummarySchema = pageScopeSchema.extend({
  id: entityIdSchema, createdAt: timestampSchema, authors: z.array(entityIdSchema), label: z.string().max(200).nullable(),
});
export const transcriptSegmentSchema = z.strictObject({ start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string() })
  .refine((segment) => segment.end >= segment.start, '转写片段结束时间不能早于开始时间');
export const assetDerivedSchema = z.strictObject({
  status: z.enum(['pending', 'processing', 'ready', 'failed']),
  description: z.string().optional(),
  ocr: z.string().optional(),
  markdown: z.string().optional(),
  transcript: z.array(transcriptSegmentSchema).optional(),
  error: z.string().optional(),
  /** Producing model id of the latest successful derivation; empty while pending/failed. */
  model: z.string().min(1).max(200).optional(),
  generatedAt: timestampSchema.optional(),
});
export const assetSchema = knowledgeBaseScopeSchema.extend({
  hash: assetHashSchema, mime: z.string().min(1).max(200), size: z.number().int().nonnegative(),
  meta: z.record(z.string(), z.json()), derived: assetDerivedSchema,
});
export const uploadIntentSchema = knowledgeBaseScopeSchema.extend({
  hash: assetHashSchema, mime: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  size: z.number().int().positive().max(5 * 1024 ** 3), name: z.string().min(1).max(255),
});

export type BlockReference = z.infer<typeof blockReferenceSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type SearchHit = z.infer<typeof searchHitSchema>;
export type CommentThread = z.infer<typeof commentThreadSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type AssetDerived = z.infer<typeof assetDerivedSchema>;
