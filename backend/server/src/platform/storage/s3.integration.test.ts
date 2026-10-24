import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { createS3ObjectStorage, readS3StorageConfig } from './s3';

describe('S3 signed server-side object transport', () => {
  test('round-trips a signed Uint8Array upload, metadata, grants and deletion through MinIO', async () => {
    const storage = createS3ObjectStorage(await readS3StorageConfig());
    const key = `storage-tests/${randomUUID()}/图片 !'()*.png`;
    const bytes = new TextEncoder().encode(`Fob S3 server upload ${randomUUID()}`);
    try {
      await storage.putObject(key, bytes, 'image/png');
      const stat = await storage.statObject(key);
      expect(stat).toMatchObject({ size: bytes.byteLength, mime: 'image/png' });
      expect(stat?.etag).toBe(createHash('md5').update(bytes).digest('hex'));

      const response = await storage.openObject(key);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      const download = await fetch(storage.presignDownload(key).url);
      expect(download.status).toBe(200);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);

      const replacement = new TextEncoder().encode('presigned replacement');
      const upload = await fetch(storage.presignUpload(key).url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: replacement });
      expect(upload.status).toBe(200);
      expect(await storage.statObject(key)).toMatchObject({ size: replacement.byteLength, mime: 'image/png' });

      expect(await storage.deleteObject(key)).toBe(true);
      expect(await storage.statObject(key)).toBeUndefined();
      await expect(storage.openObject(key)).rejects.toMatchObject({ code: 'OBJECT_MISSING' });
      await expect(storage.openObject(key, AbortSignal.abort())).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    } finally {
      await storage.deleteObject(key);
    }
  });
});
