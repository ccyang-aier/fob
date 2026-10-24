import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './sha256.messages';
const knowledgeT = createTranslator(knowledgeMessages);
/**
 * 浏览器端流式 SHA-256(U08 · 设计 §8.1 第 1 步)。
 *
 * WebCrypto 的 `subtle.digest` 只能一次性消费整个 buffer,大文件整体载入
 * 内存不可接受,因此这里实现 FIPS 180-4 的增量 SHA-256:调用方按任意分块
 * 喂入 `update`,只在内部维护 64 字节块缓冲与 8 个工作字,内存占用与文件
 * 大小无关。正确性由 NIST/RIPEMD 向量与跨块边界敏感度测试约束。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number) => ((value >>> bits) | (value << (32 - bits))) >>> 0;

export interface Sha256Hasher {
  update(chunk: Uint8Array): void;
  /** 终结并输出小写十六进制摘要;之后的 update 是程序错误。 */
  digestHex(): string;
}

export function createSha256(): Sha256Hasher {
  const block = new Uint8Array(64);
  const w = new Uint32Array(64);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  let buffered = 0;
  let bytesHashed = 0;
  let finished = false;

  function compress(input: Uint8Array) {
    for (let i = 0; i < 16; i += 1) {
      const base = i * 4;
      w[i] =
        ((input[base]! << 24) |
          (input[base + 1]! << 16) |
          (input[base + 2]! << 8) |
          input[base + 3]!) >>>
        0;
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i += 1) {
      const sum1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const choice = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + sum1 + choice + K[i]! + w[i]!) >>> 0;
      const sum0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }

  return {
    update(chunk) {
      if (finished) throw new Error(knowledgeT('sha256CannotUpdateAfterDigesthex'));
      bytesHashed += chunk.byteLength;
      let offset = 0;
      if (buffered > 0) {
        const take = Math.min(64 - buffered, chunk.byteLength);
        block.set(chunk.subarray(0, take), buffered);
        buffered += take;
        offset = take;
        if (buffered === 64) {
          compress(block);
          buffered = 0;
        }
      }
      while (offset + 64 <= chunk.byteLength) {
        compress(chunk.subarray(offset, offset + 64));
        offset += 64;
      }
      if (offset < chunk.byteLength) {
        block.set(chunk.subarray(offset));
        buffered = chunk.byteLength - offset;
      }
    },
    digestHex() {
      if (finished) throw new Error(knowledgeT('sha256DigesthexCanOnlyBeCalledOnce'));
      finished = true;
      // 比特长度恒小于 2^53(契约上限 5 GiB),number 精确。
      const bits = bytesHashed * 8;
      const padded = new Uint8Array((buffered + 72) & ~63);
      padded.set(block.subarray(0, buffered));
      padded[buffered] = 0x80;
      const high = Math.floor(bits / 0x1_0000_0000);
      const low = bits >>> 0;
      const tail = padded.length - 8;
      padded[tail] = high >>> 24;
      padded[tail + 1] = (high >>> 16) & 0xff;
      padded[tail + 2] = (high >>> 8) & 0xff;
      padded[tail + 3] = high & 0xff;
      padded[tail + 4] = low >>> 24;
      padded[tail + 5] = (low >>> 16) & 0xff;
      padded[tail + 6] = (low >>> 8) & 0xff;
      padded[tail + 7] = low & 0xff;
      for (let offset = 0; offset < padded.length; offset += 64)
        compress(padded.subarray(offset, offset + 64));
      let hex = '';
      for (let i = 0; i < 8; i += 1) hex += state[i]!.toString(16).padStart(8, '0');
      return hex;
    },
  };
}

export interface HashProgress {
  /** 已哈希字节占 Blob 大小的比例;size 为 0 时恒为 1。 */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

/**
 * 流式计算 Blob/File 的 SHA-256:经 `blob.stream()` 逐块读取,内存峰值是
 * 单个流分块(浏览器通常 ≤ 1 MiB),与文件大小无关。取消通过 signal 传
 * 递:中止时 reader 被 cancel,以 AbortError 拒绝。
 */
export async function hashBlobSha256(blob: Blob, progress: HashProgress = {}): Promise<string> {
  const hasher = createSha256();
  const reader = blob.stream().getReader();
  const abort = () => void reader.cancel().catch(() => undefined);
  progress.signal?.addEventListener('abort', abort, { once: true });
  let hashed = 0;
  try {
    for (;;) {
      progress.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      hashed += value.byteLength;
      progress.onProgress?.(blob.size > 0 ? Math.min(1, hashed / blob.size) : 1);
    }
  } finally {
    progress.signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  progress.signal?.throwIfAborted();
  return hasher.digestHex();
}
