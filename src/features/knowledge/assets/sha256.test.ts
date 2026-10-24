import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createSha256, hashBlobSha256 } from './sha256';

const encoder = new TextEncoder();

/** NIST FIPS 180-4 / 常用公开向量。 */
describe('createSha256 · 已知向量', () => {
  test('空串', () => {
    const hasher = createSha256();
    expect(hasher.digestHex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('"abc"', () => {
    const hasher = createSha256();
    hasher.update(encoder.encode('abc'));
    expect(hasher.digestHex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('448 位两块消息 "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"', () => {
    const hasher = createSha256();
    hasher.update(encoder.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'));
    expect(hasher.digestHex()).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  test('896 位三块消息(重复 "a" × 896)', () => {
    const hasher = createSha256();
    hasher.update(encoder.encode('a'.repeat(896)));
    expect(hasher.digestHex()).toBe('1585fd323312d90e1824b2bda92491d4522fbd926d8773aa32e28268dd583ef4');
  });

  test('百万个 "a" 分块喂入', () => {
    const hasher = createSha256();
    const chunk = encoder.encode('a'.repeat(1000));
    for (let i = 0; i < 1000; i += 1) hasher.update(chunk);
    expect(hasher.digestHex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  test('UTF-8 多字节内容与 Node crypto 一致', () => {
    const content = 'Fob 知识库资产 — 多模态上传 📎 sha256';
    const hasher = createSha256();
    hasher.update(encoder.encode(content));
    expect(hasher.digestHex()).toBe(createHash('sha256').update(content).digest('hex'));
  });
});

/** 分块边界敏感度:55/56/64/65/128 字节处的填充与块推进。 */
describe('createSha256 · 分块边界', () => {
  for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 127, 128, 129, 4097]) {
    test(`任意切分 ${length} 字节消息与一次性摘要一致`, () => {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + length) % 251;
      const expected = createHash('sha256').update(bytes).digest('hex');
      // 在每个可能的位置把消息切成两段,增量结果必须一致。
      for (const split of [0, 1, Math.floor(length / 3), 32, 55, 56, 63, length - 1, length]) {
        if (split < 0 || split > length) continue;
        const hasher = createSha256();
        hasher.update(bytes.subarray(0, split));
        hasher.update(bytes.subarray(split));
        expect(hasher.digestHex()).toBe(expected);
      }
    });
  }

  test('大文件规模:16 MiB 随机内容按 64KiB 分块,与 Node crypto 一致', () => {
    const total = 16 * 1024 * 1024;
    const chunkSize = 64 * 1024;
    const seedChunk = new Uint8Array(chunkSize);
    for (let i = 0; i < chunkSize; i += 1) seedChunk[i] = (i * 2654435761) % 256;
    const reference = createHash('sha256');
    const hasher = createSha256();
    for (let offset = 0; offset < total; offset += chunkSize) {
      reference.update(seedChunk);
      hasher.update(seedChunk);
    }
    expect(hasher.digestHex()).toBe(reference.digest('hex'));
  });

  test('digestHex 之后 update/digestHex 都是程序错误', () => {
    const hasher = createSha256();
    hasher.digestHex();
    expect(() => hasher.update(new Uint8Array(1))).toThrow();
    expect(() => hasher.digestHex()).toThrow();
  });
});

describe('hashBlobSha256 · 流式哈希', () => {
  test('Blob 分块流式读取结果正确且进度单调到 1', async () => {
    const content = encoder.encode('知识库资产流式哈希 · streaming sha-256 · '.repeat(500));
    const ratios: number[] = [];
    const hash = await hashBlobSha256(new Blob([content]), { onProgress: (ratio) => ratios.push(ratio) });
    expect(hash).toBe(createHash('sha256').update(content).digest('hex'));
    expect(ratios.at(-1)).toBe(1);
    for (let i = 1; i < ratios.length; i += 1) expect(ratios[i]!).toBeGreaterThanOrEqual(ratios[i - 1]!);
  });

  test('File(Blob)同一对象,流式与一次性结果一致', async () => {
    const bytes = new Uint8Array(300_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
    const hash = await hashBlobSha256(new File([bytes], 'random.bin'));
    expect(hash).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  test('中止信号以 AbortError 拒绝', async () => {
    const slowStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64));
        // 不 close:读取端在中止前一直等待下一块。
      },
    });
    const controller = new AbortController();
    const blob = new Blob([]);
    Object.defineProperty(blob, 'stream', { value: () => slowStream });
    const pending = hashBlobSha256(blob, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
