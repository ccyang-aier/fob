import { z } from 'zod';
import { assetHashSchema, entityIdSchema, timestampSchema, knowledgeBaseScopeSchema } from './primitives';
import { uploadIntentSchema } from './content';

/**
 * ready: the object was uploaded, verified against its declared hash/size/mime
 * from the actual S3 object, and asset.created was published atomically.
 * revoked: administratively disabled; downloads and re-uploads are refused.
 */
export const assetStatusSchema = z.enum(['ready', 'revoked']);

/** userId is a verified server-side identity, never accepted from request bodies. */
export const assetUploadInputSchema = uploadIntentSchema.extend({ userId: entityIdSchema });
export const assetDownloadInputSchema = knowledgeBaseScopeSchema.extend({ userId: entityIdSchema, hash: assetHashSchema });
export const assetRevokeInputSchema = knowledgeBaseScopeSchema.extend({ userId: entityIdSchema, hash: assetHashSchema });

export const assetUploadPrepareResultSchema = z.discriminatedUnion('action', [
  /** 秒传: the same hash is already confirmed inside this knowledge base. */
  z.strictObject({ action: z.literal('reuse') }),
  z.strictObject({
    action: z.literal('upload'),
    url: z.url(),
    method: z.literal('PUT'),
    /** Unsigned client obligations; confirm verifies them against the stored object. */
    headers: z.strictObject({ 'content-type': z.string() }),
    expiresAt: timestampSchema,
  }),
]);
export const assetDownloadResultSchema = z.strictObject({ url: z.url(), method: z.literal('GET'), expiresAt: timestampSchema });
export const assetConfirmResultSchema = z.strictObject({ status: assetStatusSchema, created: z.boolean() });
export const assetRevokeResultSchema = z.strictObject({ status: assetStatusSchema, changed: z.boolean() });

export type AssetStatus = z.infer<typeof assetStatusSchema>;
export type AssetUploadInput = z.infer<typeof assetUploadInputSchema>;
export type AssetDownloadInput = z.infer<typeof assetDownloadInputSchema>;
export type AssetRevokeInput = z.infer<typeof assetRevokeInputSchema>;
export type AssetUploadPrepareResult = z.infer<typeof assetUploadPrepareResultSchema>;
export type AssetDownloadResult = z.infer<typeof assetDownloadResultSchema>;
export type AssetConfirmResult = z.infer<typeof assetConfirmResultSchema>;
export type AssetRevokeResult = z.infer<typeof assetRevokeResultSchema>;
