/**
 * U08 集成测试:真实 MinIO 上的完整客户端上传闭环。
 *
 * `asset.prepare`/`asset.confirm` 的 tRPC 路由尚未由后端 API 任务装配
 * (实测运行中的知识运行时返回 NOT_FOUND),本测试以 backend AS01 已验收
 * 的 `createKnowledgeAssetStorage.presign*` 铸造与未来端点完全相同的预签
 * 名 URL(同一函数、同一凭据),驱动本特性的真实上传控制器:
 *
 * 流式 SHA-256 → 预签名 PUT(SigV4 由 MinIO 验证)→ 预签名 GET 回读 →
 * 客户端复哈希比对(完整性确认闭环的客户端半边;服务端校验是 AS01 的
 * 已验收职责)。
 *
 * MinIO 不可达时整组跳过;生产传输端口是 XHR(浏览器专属),此处以同一
 * 接口的 fetch 实现驱动,XHR 行为由组件测试与单元测试覆盖。
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createAssetUploadStore } from './upload-machine';
import type { AssetUploadPorts } from './upload-machine';
import { hashBlobSha256 } from './sha256';

/**
 * 测试文件允许引用后端工具(边界校验排除 *.test.*):presign 是 AS01 的
 * 已验收实现,重写一份只会测到复制品。根 tsconfig 不含 backend 的路径
 * 映射与 allowImportingTsExtensions,因此经非字面量说明符动态引入并
 * 在此处声明用到的最小接口(与 backend storage.ts 的公开签名一致)。
 */
interface BackendPresignGrant { url: string; expiresAt: string }
interface BackendAssetStorage {
  presignUpload(target: { knowledgeBaseId: string; hash: string }, seconds: number): BackendPresignGrant;
  presignDownload(target: { knowledgeBaseId: string; hash: string }, seconds: number): BackendPresignGrant;
  statObject(target: { knowledgeBaseId: string; hash: string }): Promise<{ size: number; mime: string; etag: string } | undefined>;
  deleteObject(target: { knowledgeBaseId: string; hash: string }): Promise<boolean>;
}
type BackendStorageModule = {
  createKnowledgeAssetStorage(config: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }): BackendAssetStorage;
  readKnowledgeAssetStorageConfig(environment?: NodeJS.ProcessEnv): Promise<{ endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }>;
};

const knowledgeBase = '31000000-0000-4000-8000-000000000003';
const encoder = new TextEncoder();

const created: { knowledgeBaseId: string; hash: string }[] = [];

/**
 * 可达性在模块顶层判定:测试注册时就要知道是否跳过。MinIO 不可达时
 * 整组诚实跳过。
 */
let storage: BackendAssetStorage;
let minioAvailable = false;
try {
  // 非字面量说明符:根 tsconfig 无 allowImportingTsExtensions,Bun 运行时
  // 正常解析到 backend 的 TS 源文件;类型由上方最小接口约束。
  const backendStorageSpecifier = '../../../../backend/server/src/modules/knowledge/assets/storage.ts';
  const backend = await import(backendStorageSpecifier) as unknown as BackendStorageModule;
  storage = backend.createKnowledgeAssetStorage(await backend.readKnowledgeAssetStorageConfig());
  // 预签名 URL 的 origin 即 MinIO origin,健康探测走同一地址。
  const granted = storage.presignUpload({ knowledgeBaseId: knowledgeBase, hash: 'f'.repeat(64) }, 60);
  const probe = await fetch(`${new URL(granted.url).origin}/minio/health/live`, { signal: AbortSignal.timeout(3000) });
  minioAvailable = probe.ok;
} catch {
  minioAvailable = false;
}

/** 公共前端测试声明尚未覆盖 skip；运行时存在。 */
const skipTest = (name: string, fn: () => void | Promise<void>) =>
  (test as unknown as { skip: (name: string, fn: () => void | Promise<void>) => void }).skip(name, fn);
/** 条件注册:可用时执行,不可达时以 skip 呈现。 */
const minioTest = minioAvailable ? test : skipTest;

afterAll(async () => {
  for (const object of created) await storage?.deleteObject(object).catch(() => undefined);
});

/** fetch 版传输端口:同一 AssetTransfer 接口,PUT 预签名 URL。 */
const fetchTransfer: AssetUploadPorts['transfer'] = async (input) => {
  const response = await fetch(input.url, {
    method: input.method,
    headers: { 'content-type': input.headers['content-type'] },
    body: input.body,
    signal: input.signal,
  });
  if (!response.ok) throw new Error(`PUT ${response.status}`);
  input.onProgress?.(1);
};

function minioPorts(): AssetUploadPorts {
  return {
    hashFile: (file, progress) => hashBlobSha256(file, progress),
    // 未装配的 asset.prepare:以 AS01 的 presign 实现扮演端点角色,返回
    // 与服务端 `{action:'upload', …}` 完全一致的形状(同一 presignUpload)。
    prepare: async (_knowledgeBaseId, intent) => {
      const granted = storage.presignUpload({ knowledgeBaseId: knowledgeBase, hash: intent.hash }, 300);
      return { action: 'upload', url: granted.url, method: 'PUT', headers: { 'content-type': intent.mime }, expiresAt: granted.expiresAt };
    },
    transfer: fetchTransfer,
    // 未装配的 asset.confirm:客户端半边的完整性闭环 —— 预签名 GET 回读
    // 对象并复哈希,与服务端 confirm 的流式校验语义一致。
    confirm: async (_knowledgeBaseId, intent) => {
      const granted = storage.presignDownload({ knowledgeBaseId: knowledgeBase, hash: intent.hash }, 120);
      const response = await fetch(granted.url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`GET ${response.status}`);
      const body = new Uint8Array(await response.arrayBuffer());
      const rehashed = await hashBlobSha256(new Blob([body]));
      if (rehashed !== intent.hash) throw new Error('回读对象哈希与申报不一致');
      if (body.byteLength !== intent.size) throw new Error('回读对象大小与申报不一致');
      return { status: 'ready', created: true };
    },
  };
}

describe('MinIO 集成 · 真实预签名直传闭环', () => {
  minioTest('流式哈希 → 预签名 PUT → GET 回读复哈希 → done', async () => {
    const content = `Fob U08 集成验收 ${randomUUID()} · 知识库附件`;
    const bytes = encoder.encode(content);
    const file = new File([bytes], 'u08-integration.txt', { type: 'text/plain' });
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports: minioPorts() });

    store.addFiles([file]);
    const deadline = Date.now() + 30_000;
    while (store.getItems()[0]!.phase !== 'done' && store.getItems()[0]!.phase !== 'error' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const final = store.getItems()[0]!;
    expect(final.phase).toBe('done');
    expect(final.error).toBeNull();
    created.push({ knowledgeBaseId: knowledgeBase, hash: final.hash! });
    expect(final.result).toEqual({ hash: final.hash, reused: false, created: true });

    // 对象真实落盘且内容逐字节一致(经服务端 SigV4 HEAD 再核一次)。
    const stat = await storage.statObject({ knowledgeBaseId: knowledgeBase, hash: final.hash! });
    expect(stat?.size).toBe(bytes.byteLength);
    expect(stat?.mime).toContain('text/plain');
  });

  minioTest('同一内容第二次上传在 prepare 探测处命中秒传分支', async () => {
    const content = `Fob U08 秒传 ${randomUUID()}`;
    const file = new File([encoder.encode(content)], 'dedupe.txt', { type: 'text/plain' });
    const ports = minioPorts();
    let transferCalls = 0;
    ports.transfer = async (input) => {
      transferCalls += 1;
      return fetchTransfer(input);
    };
    const store = createAssetUploadStore({ knowledgeBaseId: knowledgeBase, ports });

    store.addFiles([file]);
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const phase = store.getItems()[0]!.phase;
        if (phase === 'done') { clearInterval(timer); resolve(); }
        if (phase === 'error') { clearInterval(timer); reject(new Error('first upload failed')); }
      }, 20);
      setTimeout(() => { clearInterval(timer); reject(new Error('timeout')); }, 30_000);
    });
    const firstHash = store.getItems()[0]!.hash!;
    created.push({ knowledgeBaseId: knowledgeBase, hash: firstHash });

    // 第二次:prepare 端点(由 AS01 服务逻辑保证)将返回 reuse;此处端口
    // 直接按服务端语义返回,验证客户端对秒传分支的处理(不 PUT、不确认)。
    ports.prepare = async () => ({ action: 'reuse' });
    const [second] = store.addFiles([new File([encoder.encode(content)], 'dedupe-2.txt', { type: 'text/plain' })]);
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const phase = store.getItems().find((entry) => entry.id === second!.id)!.phase;
        if (phase === 'done') { clearInterval(timer); resolve(); }
        if (phase === 'error') { clearInterval(timer); reject(new Error('reuse upload failed')); }
      }, 20);
      setTimeout(() => { clearInterval(timer); reject(new Error('timeout')); }, 10_000);
    });
    expect(transferCalls).toBe(1); // 只有第一次发生了直传
    const reused = store.getItems().find((entry) => entry.id === second!.id)!;
    expect(reused.result).toEqual({ hash: firstHash, reused: true, created: false });
  });
});
