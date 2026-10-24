export type AssetErrorCode =
  | 'INVALID_ASSET_INPUT'
  | 'INVALID_STORAGE_CONFIG'
  | 'ASSET_ACCESS_DENIED'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_NOT_READY'
  | 'ASSET_OBJECT_MISSING'
  | 'ASSET_HASH_MISMATCH'
  | 'ASSET_SIZE_MISMATCH'
  | 'ASSET_MIME_MISMATCH'
  | 'ASSET_STORAGE_UNAVAILABLE';

/** Internal service errors: HTTP authentication/authorization mapping belongs to the API layer. */
export class KnowledgeAssetError extends Error {
  constructor(readonly code: AssetErrorCode) {
    super(`Knowledge asset operation failed: ${code}`);
    this.name = 'KnowledgeAssetError';
  }
}
