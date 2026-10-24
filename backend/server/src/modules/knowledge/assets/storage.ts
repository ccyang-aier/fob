import { assetHashSchema, entityIdSchema } from '@fob/shared/knowledge/contracts';
import { createS3ObjectStorage, readS3StorageConfig, S3StorageError } from '../../../platform/storage/s3';
import { KnowledgeAssetError, type AssetErrorCode } from './errors';

/** Matches the runtime `config.storage` shape so composition passes it through unchanged. */
export interface KnowledgeAssetStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const storageErrors = {
  STORAGE_UNAVAILABLE: 'ASSET_STORAGE_UNAVAILABLE',
  OBJECT_MISSING: 'ASSET_OBJECT_MISSING',
  INVALID_STORAGE_CONFIG: 'INVALID_STORAGE_CONFIG',
  INVALID_OBJECT_INPUT: 'INVALID_ASSET_INPUT',
} as const satisfies Record<S3StorageError['code'], AssetErrorCode>;

function translateStorageError(error: unknown): never {
  if (error instanceof S3StorageError) throw new KnowledgeAssetError(storageErrors[error.code]);
  throw error;
}

export async function readKnowledgeAssetStorageConfig(environment: NodeJS.ProcessEnv = process.env): Promise<KnowledgeAssetStorageConfig> {
  return readS3StorageConfig(environment).catch(translateStorageError);
}

export interface AssetObjectStat { size: number; mime: string; etag: string }
export interface AssetPresignedUrl { url: string; expiresAt: string }
export interface AssetObjectAddress { knowledgeBaseId: string; hash: string }

/** Identical content belongs to independent objects in each knowledge base. */
function objectKey(input: AssetObjectAddress) {
  if (!entityIdSchema.safeParse(input.knowledgeBaseId).success || !assetHashSchema.safeParse(input.hash).success) {
    throw new KnowledgeAssetError('INVALID_ASSET_INPUT');
  }
  return `${input.knowledgeBaseId}/${input.hash}`;
}

/** Knowledge-base ownership and validation remain here; S3 signing is shared platform transport. */
export function createKnowledgeAssetStorage(input: KnowledgeAssetStorageConfig) {
  let storage;
  try { storage = createS3ObjectStorage(input); } catch (error) { translateStorageError(error); }

  return {
    objectKey,
    presignUpload(target: AssetObjectAddress, expiresInSeconds = 600): AssetPresignedUrl {
      try { return storage.presignUpload(objectKey(target), expiresInSeconds); } catch (error) { return translateStorageError(error); }
    },
    presignDownload(target: AssetObjectAddress, expiresInSeconds = 300): AssetPresignedUrl {
      try { return storage.presignDownload(objectKey(target), expiresInSeconds); } catch (error) { return translateStorageError(error); }
    },
    async statObject(target: AssetObjectAddress, signal?: AbortSignal): Promise<AssetObjectStat | undefined> {
      return storage.statObject(objectKey(target), signal).catch(translateStorageError);
    },
    async openObject(target: AssetObjectAddress, signal?: AbortSignal): Promise<Response> {
      return storage.openObject(objectKey(target), signal).catch(translateStorageError);
    },
    async deleteObject(target: AssetObjectAddress, signal?: AbortSignal): Promise<boolean> {
      return storage.deleteObject(objectKey(target), signal).catch(translateStorageError);
    },
  };
}

export type KnowledgeAssetStorage = ReturnType<typeof createKnowledgeAssetStorage>;
