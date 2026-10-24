import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AssetUploadPrepareResult, AssetConfirmResult } from '@fob/shared/knowledge/contracts';
import { AssetTransferError } from './transfer';
import { createAssetUploadStore, assetMaxBytes } from './upload-machine';
import type { AssetUploadPorts } from './upload-machine';

/**
 * 假端口驱动的上传状态机测试(U08 验收):全流程字节进度、秒传分支、
 * 哈希/传输/确认三相位取消、失败后重试(哈希复用)、错误分类与文件
 * 契约预检。传输是假 PUT,但哈希端口走真实的 hashBlobSha256 语义替身。
 */

const knowledgeBase = '20000000-0000-4000-8000-000000000000';
const encoder = new TextEncoder();

function fileOf(content: string, name = '笔记.txt', mime = 'text/plain'): File {
  return new File([encoder.encode(content)], name, { type: mime });
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface PortScript {
  prepareResult?: AssetUploadPrepareResult | ((intent: { hash: string }) => AssetUploadPrepareResult);
  confirmResult?: AssetConfirmResult;
  prepareError?: Error;
  transferError?: Error;
  confirmError?: Error;
  /** 传输前阻塞,测试者在此触发 cancel/retry。 */
  onTransferStart?: (context: { id: string; cancel: () => void; retry: () => void }) => void;
  transferDelayMs?: number;
}

interface Harness {
  ports: AssetUploadPorts;
  log: string[];
  transfers: { url: string; header: string; bytes: Uint8Array }[];
  prepares: { hash: string }[];
  confirms: { hash: string }[];
  hashCalls: number;
}

function harness(script: PortScript = {}): Harness {
  const log: string[] = [];
  const transfers: Harness['transfers'] = [];
  const prepares: { hash: string }[] = [];
  const confirms: { hash: string }[] = [];
  const state: Harness = {
    log, transfers, prepares, confirms,
    hashCalls: 0,
    ports: {
      async hashFile(file, { onProgress, signal }) {
        state.hashCalls += 1;
        // 与真实端口同语义:分块读 File + 进度;这里用 3 块模拟。
        const bytes = new Uint8Array(await file.arrayBuffer());
        const hasher = createHash('sha256');
        const third = Math.ceil(bytes.byteLength / 3) || 1;
        for (let offset = 0; offset < bytes.byteLength; offset += third) {
          signal.throwIfAborted();
          hasher.update(bytes.subarray(offset, offset + third));
          onProgress(Math.min(1, (offset + third) / bytes.byteLength));
        }
        return hasher.digest('hex');
      },
      async prepare(_knowledgeBase, intent) {
        prepares.push({ hash: intent.hash });
        log.push(`prepare:${intent.hash.slice(0, 6)}`);
        if (script.prepareError) throw script.prepareError;
        return typeof script.prepareResult === 'function' ? script.prepareResult(intent) : (script.prepareResult ?? { action: 'upload', url: `https://s3.test/put/${intent.hash}`, method: 'PUT', headers: { 'content-type': intent.mime }, expiresAt: '2026-09-26T12:10:00.000Z' });
      },
      async transfer(input) {
        const bytes = new Uint8Array(await input.body.arrayBuffer());
        transfers.push({ url: input.url, header: input.headers['content-type'], bytes });
        log.push('transfer');
        if (script.transferDelayMs) await new Promise((resolve) => setTimeout(resolve, script.transferDelayMs));
        if (script.onTransferStart) script.onTransferStart({ id: '', cancel: () => undefined, retry: () => undefined });
        if (script.transferError) throw script.transferError;
        for (let quarter = 1; quarter <= 4; quarter += 1) {
          input.signal?.throwIfAborted();
          input.onProgress?.(quarter / 4);
        }
      },
      async confirm(_knowledgeBase, intent) {
        confirms.push({ hash: intent.hash });
        log.push('confirm');
        if (script.confirmError) throw script.confirmError;
        return script.confirmResult ?? { status: 'ready', created: true };
      },
    },
  };
  return state;
}

/** 轮询到给定断言通过或超时;状态机是事件驱动的异步流水线。 */
async function until(assertion: () => void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (cause) {
      if (Date.now() > deadline) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

describe('上传状态机 · 全流程', () => {
  test('哈希 → prepare → 直传(进度 0→1)→ confirm → done(created)', async () => {
    const state = harness();
    const completions: { hash: string; reused: boolean }[] = [];
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports, onUploaded: (asset) => completions.push({ hash: asset.hash, reused: asset.reused }) });
    store.addFiles([fileOf('Fob 全流程验收内容')]);
    await until(() => expect(store.getItems()[0]!.phase).toBe('done'));

    const final = store.getItems()[0]!;
    const hash = sha256('Fob 全流程验收内容');
    expect(final.hash).toBe(hash);
    expect(final.result).toEqual({ hash, reused: false, created: true });
    expect(final.progress).toBe(1);
    expect(final.error).toBeNull();
    expect(state.log).toEqual([`prepare:${hash.slice(0, 6)}`, 'transfer', 'confirm']);
    expect(state.transfers[0]).toMatchObject({ url: `https://s3.test/put/${hash}`, header: 'text/plain' });
    expect(Buffer.compare(Buffer.from(state.transfers[0]!.bytes), encoder.encode('Fob 全流程验收内容'))).toBe(0);
    expect(completions).toEqual([{ hash, reused: false }]);
  });

  test('秒传:prepare 返回 reuse 时跳过传输与确认,立即完成', async () => {
    const state = harness({ prepareResult: { action: 'reuse' } });
    const completions: { hash: string; reused: boolean }[] = [];
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports, onUploaded: (asset) => completions.push({ hash: asset.hash, reused: asset.reused }) });
    store.addFiles([fileOf('秒传命中内容')]);
    await until(() => expect(store.getItems()[0]!.phase).toBe('done'));

    const final = store.getItems()[0]!;
    const hash = sha256('秒传命中内容');
    expect(final.result).toEqual({ hash, reused: true, created: false });
    expect(state.transfers).toHaveLength(0);
    expect(state.confirms).toHaveLength(0);
    expect(completions).toEqual([{ hash, reused: true }]);
  });

  test('进度量化:传输相位可见的单调进度且终值为 1', async () => {
    const state = harness();
    const seen: number[] = [];
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    store.subscribe(() => {
      const item = store.getItems()[0];
      if (item && item.phase === 'uploading' && seen.at(-1) !== item.progress) seen.push(item.progress);
    });
    store.addFiles([fileOf('进度观测')]);
    await until(() => expect(store.getItems()[0]!.phase).toBe('done'));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
  });
});

describe('上传状态机 · 取消', () => {
  test('哈希相位取消 → canceled,无 prepare', async () => {
    let releaseHash: (() => void) | undefined;
    const state = harness();
    state.ports.hashFile = (file, { onProgress, signal }) =>
      new Promise<string>((resolve, reject) => {
        onProgress(0.5);
        releaseHash = () => {
          signal.throwIfAborted();
          resolve(sha256(''));
        };
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    const [item] = store.addFiles([fileOf('哈希中取消')]);
    await until(() => expect(releaseHash).toBeDefined());
    store.cancel(item!.id);
    await until(() => expect(store.getItems()[0]!.phase).toBe('canceled'));
    expect(state.prepares).toHaveLength(0);
    expect(store.getItems()[0]!.error).toBeNull();
  });

  test('传输相位取消 → canceled,不 confirm', async () => {
    let onPutArrived!: () => void;
    const putArrived = new Promise<void>((resolve) => { onPutArrived = resolve; });
    const state = harness();
    state.ports.transfer = async (input) => {
      onPutArrived();
      await new Promise<void>((resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal!.reason), { once: true });
      });
      input.onProgress?.(0.4);
    };
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    const [item] = store.addFiles([fileOf('传输中取消')]);
    await putArrived;
    store.cancel(item!.id);
    await until(() => expect(store.getItems()[0]!.phase).toBe('canceled'));
    expect(state.confirms).toHaveLength(0);
  });

  test('确认相位取消 → canceled(即使对象已上传)', async () => {
    let onConfirmArrived!: () => void;
    const confirmArrived = new Promise<void>((resolve) => { onConfirmArrived = resolve; });
    const state = harness();
    state.ports.confirm = (_knowledgeBaseId, _intent, signal) =>
      new Promise((_resolve, reject) => {
        onConfirmArrived();
        signal?.addEventListener('abort', () => reject(signal!.reason), { once: true });
      });
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    const [item] = store.addFiles([fileOf('确认中取消')]);
    await confirmArrived;
    store.cancel(item!.id);
    await until(() => expect(store.getItems()[0]!.phase).toBe('canceled'));
    expect(state.transfers).toHaveLength(1);
  });
});

describe('上传状态机 · 错误与重试', () => {
  test('prepare 失败 → error(PREPARE_FAILED),重试复用哈希并成功', async () => {
    let failFirst = true;
    const state = harness({
      prepareResult: () => {
        if (failFirst) {
          failFirst = false;
          throw Object.assign(new Error('The requested operation was not found.'), { name: 'TRPCClientError' });
        }
        return { action: 'upload', url: 'https://s3.test/put/retry', method: 'PUT', headers: { 'content-type': 'text/plain' }, expiresAt: '2026-09-26T12:10:00.000Z' };
      },
    });
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    const [item] = store.addFiles([fileOf('重试流程内容')]);
    await until(() => expect(store.getItems()[0]!.phase).toBe('error'));

    const failed = store.getItems()[0]!;
    expect(failed.error!.code).toBe('PREPARE_FAILED');
    expect(failed.hash).toBe(sha256('重试流程内容'));

    store.retry(item!.id);
    await until(() => expect(store.getItems()[0]!.phase).toBe('done'));
    const done = store.getItems()[0]!;
    expect(done.attempts).toBe(2);
    expect(done.result!.created).toBe(true);
    // 重试没有重新哈希。
    expect(state.hashCalls).toBe(1);
  });

  test('传输网络错误 → TRANSFER_NETWORK,带 detail 的拒绝 → TRANSFER_REJECTED', async () => {
    const network = harness({ transferError: new AssetTransferError('network') });
    const storeA = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: network.ports });
    storeA.addFiles([fileOf('网络错误内容')]);
    await until(() => expect(storeA.getItems()[0]!.phase).toBe('error'));
    expect(storeA.getItems()[0]!.error!.code).toBe('TRANSFER_NETWORK');

    const rejected = harness({ transferError: new AssetTransferError('status', 403) });
    const storeB = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: rejected.ports });
    storeB.addFiles([fileOf('拒绝错误内容')]);
    await until(() => expect(storeB.getItems()[0]!.phase).toBe('error'));
    expect(storeB.getItems()[0]!.error).toEqual({ code: 'TRANSFER_REJECTED', detail: 'HTTP 403' });
  });

  test('confirm 哈希不匹配(服务端已删除对象)→ CONFIRM_FAILED,重试重新走完整上传', async () => {
    let confirmAttempts = 0;
    const state = harness({
      confirmResult: undefined,
    });
    state.ports.confirm = async () => {
      confirmAttempts += 1;
      if (confirmAttempts === 1) {
        const error = new Error('完整性确认未通过(ASSET_HASH_MISMATCH)。') as Error & { code?: string };
        error.code = 'ASSET_HASH_MISMATCH';
        throw error;
      }
      return { status: 'ready', created: true };
    };
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    const [item] = store.addFiles([fileOf('确认闭环内容')]);
    await until(() => expect(store.getItems()[0]!.phase).toBe('error'));
    expect(store.getItems()[0]!.error!.code).toBe('CONFIRM_FAILED');

    store.retry(item!.id);
    await until(() => expect(store.getItems()[0]!.phase).toBe('done'));
    expect(state.transfers).toHaveLength(2); // 对象被删,重试必须重新直传
    expect(confirmAttempts).toBe(2);
  });

  test('取消后重试继续上传(哈希复用)', async () => {
    let onPutArrived!: () => void;
    const putArrived = new Promise<void>((resolve) => { onPutArrived = resolve; });
    let hanging = true;
    const state = harness();
    state.ports.transfer = async (input) => {
      if (hanging) onPutArrived();
      await new Promise<void>((resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal!.reason), { once: true });
        if (!hanging) resolve();
      });
    };
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    const [item] = store.addFiles([fileOf('取消后重试')]);
    await putArrived;
    store.cancel(item!.id);
    await until(() => expect(store.getItems()[0]!.phase).toBe('canceled'));

    hanging = false;
    store.retry(item!.id);
    await until(() => expect(store.getItems()[0]!.phase).toBe('done'));
    expect(store.getItems()[0]!.attempts).toBe(2);
    expect(state.hashCalls).toBe(1);
  });
});

describe('上传状态机 · 文件契约预检', () => {
  test('超过 5 GiB 的文件不入队流水线,直接 FILE_INVALID', async () => {
    const state = harness();
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    const huge = new File([new Uint8Array([1])], 'huge.bin');
    Object.defineProperty(huge, 'size', { value: assetMaxBytes + 1 });
    const [item] = store.addFiles([huge]);
    expect(item!.phase).toBe('error');
    expect(item!.error!.code).toBe('FILE_INVALID');
    expect(state.hashCalls).toBe(0);
    expect(state.prepares).toHaveLength(0);
  });

  test('空文件同样被预检拒绝', () => {
    const state = harness();
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    const [item] = store.addFiles([new File([new Uint8Array(0)], 'empty.txt', { type: 'text/plain' })]);
    expect(item!.phase).toBe('error');
    expect(item!.error!.detail).toContain('空文件');
  });

  test('缺 mime 的文件回退 application/octet-stream 并完成上传', async () => {
    const state = harness();
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    store.addFiles([new File([encoder.encode('x')], 'noext', { type: '' })]);
    await until(() => expect(store.getItems()[0]!.phase).toBe('done'));
    expect(state.transfers[0]!.header).toBe('application/octet-stream');
  });
});

describe('上传状态机 · 队列操作', () => {
  test('remove 中止进行中的流水线并从队列消失;clearFinished 清理终态项', async () => {
    let onPutArrived!: () => void;
    const putArrived = new Promise<void>((resolve) => { onPutArrived = resolve; });
    let hanging = true;
    const state = harness();
    state.ports.transfer = async (input) => {
      if (hanging) onPutArrived();
      await new Promise<void>((resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal!.reason), { once: true });
        if (!hanging) resolve();
      });
    };
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    const [active] = store.addFiles([fileOf('移除进行中')]);
    await putArrived;
    hanging = false; // 后续文件正常完成
    const [done] = store.addFiles([new File([encoder.encode('y')], 'done.txt', { type: 'text/plain' })]);
    await until(() => expect(store.getItems().find((entry) => entry.id === done!.id)!.phase).toBe('done'));

    store.remove(active!.id);
    expect(store.getItems().some((entry) => entry.id === active!.id)).toBe(false);

    store.clearFinished();
    expect(store.getItems()).toHaveLength(0);
  });

  test('多文件并发:各自独立完成,互不阻塞', async () => {
    const state = harness();
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: state.ports });
    store.addFiles([fileOf('并发一'), fileOf('并发二'), fileOf('并发三')]);
    await until(() => expect(store.getItems().every((item) => item.phase === 'done')).toBe(true));
    // 队列顺序是插入顺序,与完成顺序无关。
    expect(store.getItems().map((item) => item.result!.hash)).toEqual([sha256('并发一'), sha256('并发二'), sha256('并发三')]);
  });
});
