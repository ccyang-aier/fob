import { describe, expect, test } from 'bun:test';
import { createS3ObjectStorage, readS3StorageConfig, S3StorageError, type S3StorageConfig } from './s3';

const config: S3StorageConfig = {
  endpoint: 'http://127.0.0.1:59000', region: 'us-east-1', bucket: 'fob-storage', accessKeyId: 'testing', secretAccessKey: 'testing',
};
const storage = createS3ObjectStorage(config);

describe('S3 object transport boundaries', () => {
  test('validates explicit environment configuration without silently falling back', async () => {
    await expect(readS3StorageConfig({
      S3_ENDPOINT: config.endpoint, S3_REGION: config.region, S3_BUCKET: config.bucket,
      S3_ACCESS_KEY_ID: config.accessKeyId, S3_SECRET_ACCESS_KEY: config.secretAccessKey,
    })).resolves.toEqual(config);
    await expect(readS3StorageConfig({ S3_ENDPOINT: 'ftp://storage.internal:9000' })).rejects.toMatchObject({ code: 'INVALID_STORAGE_CONFIG' });
    expect(() => createS3ObjectStorage({ ...config, endpoint: 'https://storage.internal/prefix' })).toThrow(S3StorageError);
    expect(() => createS3ObjectStorage({ ...config, bucket: 'Uppercase-Bucket' })).toThrow(S3StorageError);
  });

  test('refuses absolute keys, empty segments and traversal before issuing grants', () => {
    for (const key of ['', '/absolute', '../outside', 'tasks/../outside', 'tasks/./image', 'tasks//image', 'C:/image', 'tasks\\image', 'tasks/\u0000image']) {
      expect(() => storage.presignUpload(key)).toThrow(S3StorageError);
      expect(() => storage.presignDownload(key)).toThrow(S3StorageError);
    }
  });

  test('encodes each key segment strictly and binds grants to method and expiry', () => {
    const key = "tasks/项目 a/image!'()*.png";
    const upload = new URL(storage.presignUpload(key).url);
    const download = new URL(storage.presignDownload(key).url);
    expect(upload.pathname).toBe('/fob-storage/tasks/%E9%A1%B9%E7%9B%AE%20a/image%21%27%28%29%2A.png');
    expect(upload.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(download.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(upload.searchParams.get('X-Amz-Signature')).not.toBe(download.searchParams.get('X-Amz-Signature'));
    expect(() => storage.presignUpload(key, 0)).toThrow(S3StorageError);
    expect(() => storage.presignDownload(key, 3601)).toThrow(S3StorageError);
  });

  test('rejects invalid request keys and MIME headers without I/O', async () => {
    const bytes = new TextEncoder().encode('test');
    await expect(storage.putObject('/absolute', bytes, 'image/png')).rejects.toMatchObject({ code: 'INVALID_OBJECT_INPUT' });
    await expect(storage.openObject('../outside')).rejects.toMatchObject({ code: 'INVALID_OBJECT_INPUT' });
    await expect(storage.statObject('tasks//image')).rejects.toMatchObject({ code: 'INVALID_OBJECT_INPUT' });
    await expect(storage.deleteObject('tasks\\image')).rejects.toMatchObject({ code: 'INVALID_OBJECT_INPUT' });
    await expect(storage.putObject('tasks/image', bytes, '')).rejects.toMatchObject({ code: 'INVALID_OBJECT_INPUT' });
    await expect(storage.putObject('tasks/image', bytes, 'image/png\r\nx-injected: true')).rejects.toMatchObject({ code: 'INVALID_OBJECT_INPUT' });
  });
});
