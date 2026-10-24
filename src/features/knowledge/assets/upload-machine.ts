'use client';

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './upload-machine.messages';

/**
 * 资产上传控制器(U08 · 设计 §8.1):一个文件一条独立流水线 ——
 * 哈希 → prepare(秒传探测)→ 预签名直传 → confirm(完整性确认)。
 *
 * - 秒传:prepare 返回 `{action:'reuse'}` 时立即完成,不发起 PUT 与 confirm。
 * - 进度:哈希与直传按字节比例上报,控制器量化到 0.5% 以内再广播,避免
 *   每个流分块都触发一次 React 提交。
 * - 取消:单条流水线一个 AbortController;哈希流、tRPC 调用与 XHR 传输都
 *   挂在同一信号上,取消是确定性的(相位落 canceled,不是 error)。
 * - 重试:仅从 error/canceled 出发;已算出的哈希复用,直接重新 prepare
 *   (预签名授权可能已过期或对象已被确认删除,重新探测永远正确)。
 *
 * 所有 IO 端口注入:浏览器装配传 XHR 传输与 tRPC API;测试传假端口。
 */

import type {
  AssetConfirmResult,
  AssetUploadPrepareResult,
} from '@fob/shared/knowledge/contracts';
import { KnowledgeDataError } from '../data/errors';
import { hashBlobSha256 } from './sha256';
import type { AssetTransfer } from './transfer';
import { AssetTransferError } from './transfer';
import type { KnowledgeAssetsApi } from './assets-api';

const knowledgeT = createTranslator(knowledgeMessages);

/** `uploadIntentSchema` 的客户端镜像:超限/空文件在哈希前就给出可见错误。 */
export const assetMaxBytes = 5 * 1024 ** 3;
const mimePattern = /^[\w.+-]+\/[\w.+-]+$/;

export type AssetUploadPhase =
  'hashing' | 'preparing' | 'uploading' | 'confirming' | 'done' | 'canceled' | 'error';

export type AssetUploadErrorCode =
  | 'FILE_INVALID'
  | 'HASH_FAILED'
  | 'PREPARE_FAILED'
  | 'TRANSFER_NETWORK'
  | 'TRANSFER_REJECTED'
  | 'CONFIRM_FAILED';

export interface AssetUploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  mime: string;
  phase: AssetUploadPhase;
  /** 当前字节相位内的进度 0..1;preparing/confirming 为不确定相位,由视图按相位呈现。 */
  progress: number;
  hash: string | null;
  error: { code: AssetUploadErrorCode; detail: string | null } | null;
  /** 第几次尝试,从 1 起;重试 +1。 */
  attempts: number;
  result: { hash: string; reused: boolean; created: boolean } | null;
}

export interface AssetUploadPorts {
  hashFile(
    file: File,
    progress: { onProgress: (ratio: number) => void; signal: AbortSignal },
  ): Promise<string>;
  prepare(
    knowledgeBaseId: string,
    intent: { hash: string; mime: string; size: number; name: string },
    signal?: AbortSignal,
  ): Promise<AssetUploadPrepareResult>;
  transfer: AssetTransfer;
  confirm(
    knowledgeBaseId: string,
    intent: { hash: string; mime: string; size: number; name: string },
    signal?: AbortSignal,
  ): Promise<AssetConfirmResult>;
}

export interface UploadedAsset {
  hash: string;
  name: string;
  mime: string;
  size: number;
  /** 秒传命中(知识库已有同哈希资产);此时没有新对象写入。 */
  reused: boolean;
  /** 本次 confirm 是否创建了新资产行(并发确认的另一方可能已创建)。 */
  created: boolean;
}

export interface AssetUploadStore {
  getItems(): readonly AssetUploadItem[];
  subscribe(listener: () => void): () => void;
  /** 加入即开始上传;不合契约的文件以 FILE_INVALID 错误项呈现,不静默丢弃。 */
  addFiles(files: Iterable<File>): readonly AssetUploadItem[];
  cancel(id: string): void;
  retry(id: string): void;
  remove(id: string): void;
  /** 清除全部终态项(完成/取消/错误)。 */
  clearFinished(): void;
}

export function createAssetUploadStore(options: {
  knowledgeBaseId: string;
  ports: AssetUploadPorts;
  onUploaded?: (asset: UploadedAsset) => void;
}): AssetUploadStore {
  const { knowledgeBaseId, ports } = options;
  let items: AssetUploadItem[] = [];
  const listeners = new Set<() => void>();
  const controllers = new Map<string, AbortController>();
  const progressStep = 1 / 200;
  let sequence = 0;

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const patch = (id: string, changes: Partial<AssetUploadItem>) => {
    items = items.map((item) => (item.id === id ? { ...item, ...changes } : item));
    emit();
  };
  const find = (id: string) => items.find((item) => item.id === id);

  /** 相位内字节进度:量化广播,保证快照引用只在有意义的进度变化时更新。 */
  const byteProgress = (id: string) => {
    let announced = -1;
    return (ratio: number) => {
      const quantized = ratio >= 1 ? 1 : Math.floor(ratio / progressStep) * progressStep;
      if (quantized > announced) {
        announced = quantized;
        patch(id, { progress: quantized });
      }
    };
  };

  const intentOf = (item: AssetUploadItem, hash: string) => ({
    hash,
    mime: item.mime,
    size: item.size,
    name: item.name,
  });

  /** 取消信号是相位语义不是错误:统一在 catch 处按 signal.aborted 分流。 */
  const tagged = (
    origin: 'hash' | 'prepare' | 'transfer' | 'confirm',
    cause: unknown,
  ): AssetUploadItem['error'] => {
    if (cause instanceof AssetTransferError) {
      return cause.kind === 'network'
        ? { code: 'TRANSFER_NETWORK', detail: null }
        : {
            code: 'TRANSFER_REJECTED',
            detail: cause.status === null ? null : `HTTP ${cause.status}`,
          };
    }
    const code: AssetUploadErrorCode =
      origin === 'hash'
        ? 'HASH_FAILED'
        : origin === 'prepare'
          ? 'PREPARE_FAILED'
          : origin === 'confirm'
            ? 'CONFIRM_FAILED'
            : 'TRANSFER_NETWORK';
    const detail =
      cause instanceof KnowledgeDataError
        ? cause.message
        : cause instanceof Error && cause.message
          ? cause.message
          : null;
    return { code, detail };
  };

  async function pipeline(item: AssetUploadItem) {
    const controller = new AbortController();
    controllers.set(item.id, controller);
    const signal = controller.signal;
    const failFast = () => {
      if (signal.aborted)
        throw signal.reason ?? new DOMException(knowledgeT('uploadCancelled'), 'AbortError');
    };
    const guard = <T>(
      origin: 'hash' | 'prepare' | 'transfer' | 'confirm',
      work: () => Promise<T>,
    ): Promise<T> =>
      work().catch((cause: unknown) => {
        if (signal.aborted)
          throw signal.reason ?? new DOMException(knowledgeT('uploadCancelled'), 'AbortError');
        throw Object.assign(new Error(origin), { cause, origin });
      });

    try {
      let hash = item.hash;
      if (!hash) {
        patch(item.id, { phase: 'hashing', progress: 0 });
        hash = await guard('hash', () =>
          ports.hashFile(item.file, { onProgress: byteProgress(item.id), signal }),
        );
        patch(item.id, { hash });
      }
      failFast();
      patch(item.id, { phase: 'preparing' });
      const prepared = await guard('prepare', () =>
        ports.prepare(knowledgeBaseId, intentOf(item, hash!), signal),
      );
      failFast();

      if (prepared.action === 'reuse') {
        // 秒传:知识库已有同哈希资产,既不传输也不确认。
        return finish(item, { hash: hash!, reused: true, created: false });
      }

      patch(item.id, { phase: 'uploading', progress: 0 });
      await guard('transfer', () =>
        ports.transfer({
          url: prepared.url,
          method: 'PUT',
          headers: prepared.headers,
          body: item.file,
          onProgress: byteProgress(item.id),
          signal,
        }),
      );
      failFast();

      patch(item.id, { phase: 'confirming' });
      const confirmed = await guard('confirm', () =>
        ports.confirm(knowledgeBaseId, intentOf(item, hash!), signal),
      );
      return finish(item, { hash: hash!, reused: false, created: confirmed.created });
    } catch (cause) {
      const taggedCause = cause as { origin?: 'hash' | 'prepare' | 'transfer' | 'confirm' } & {
        cause?: unknown;
      };
      if (signal.aborted) patch(item.id, { phase: 'canceled', progress: 0, error: null });
      else
        patch(item.id, {
          phase: 'error',
          progress: 0,
          error: taggedCause.origin
            ? tagged(taggedCause.origin, taggedCause.cause)
            : { code: 'TRANSFER_NETWORK', detail: null },
        });
    } finally {
      controllers.delete(item.id);
    }
  }

  function finish(
    item: AssetUploadItem,
    result: { hash: string; reused: boolean; created: boolean },
  ) {
    patch(item.id, {
      phase: 'done',
      progress: 1,
      error: null,
      result: { hash: result.hash, reused: result.reused, created: result.created },
    });
    options.onUploaded?.({
      hash: result.hash,
      name: item.name,
      mime: item.mime,
      size: item.size,
      reused: result.reused,
      created: result.created,
    });
  }

  function validate(file: File): { mime: string } | { invalid: string } {
    if (!(file.size > 0 && file.size <= assetMaxBytes))
      return {
        invalid:
          file.size > assetMaxBytes
            ? knowledgeT('fileExceedsThe5GibLimit')
            : knowledgeT('emptyFilesCannotBeUploaded'),
      };
    if (file.name.length < 1 || file.name.length > 255)
      return { invalid: knowledgeT('fileNamesMustContain1255Characters') };
    // 与服务端 normalizeMime 同语义:去掉参数、小写;浏览器给的 type 已如此,
    // 非浏览器运行时(如 Bun)会带 `;charset=…` 参数,契约正则不接受。
    const raw = file.type.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    const mime = raw && mimePattern.test(raw) ? raw : 'application/octet-stream';
    return { mime };
  }

  function enqueue(file: File): AssetUploadItem {
    sequence += 1;
    const check = validate(file);
    const item: AssetUploadItem = {
      id: `asset-upload-${sequence}`,
      file,
      name: file.name,
      size: file.size,
      mime: 'mime' in check ? check.mime : 'application/octet-stream',
      phase: 'invalid' in check ? 'error' : 'hashing',
      progress: 0,
      hash: null,
      error: 'invalid' in check ? { code: 'FILE_INVALID', detail: check.invalid } : null,
      attempts: 1,
      result: null,
    };
    items = [...items, item];
    return item;
  }

  return {
    getItems: () => items,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addFiles(files) {
      const added = [...files].map(enqueue);
      emit();
      for (const item of added) {
        if (!item.error) void pipeline(item);
      }
      return added;
    },
    cancel(id) {
      controllers.get(id)?.abort();
    },
    retry(id) {
      const current = find(id);
      if (!current || (current.phase !== 'error' && current.phase !== 'canceled')) return;
      const next: AssetUploadItem = {
        ...current,
        phase: current.hash ? 'preparing' : 'hashing',
        progress: 0,
        error: null,
        attempts: current.attempts + 1,
      };
      items = items.map((item) => (item.id === id ? next : item));
      emit();
      void pipeline(next);
    },
    remove(id) {
      controllers.get(id)?.abort();
      if (find(id)) {
        items = items.filter((item) => item.id !== id);
        emit();
      }
    },
    clearFinished() {
      const before = items.length;
      items = items.filter(
        (item) => item.phase !== 'done' && item.phase !== 'canceled' && item.phase !== 'error',
      );
      if (items.length !== before) emit();
    },
  };
}

/** 浏览器默认端口:tRPC 资产 API + XHR 直传 + 流式哈希。 */
export function createBrowserAssetUploadPorts(
  api: KnowledgeAssetsApi,
  transfer: AssetTransfer,
): AssetUploadPorts {
  return {
    hashFile: (file, progress) => hashBlobSha256(file, progress),
    prepare: (knowledgeBase, intent, signal) => api.prepareUpload(knowledgeBase, intent, signal),
    transfer,
    confirm: (knowledgeBase, intent, signal) => api.confirmUpload(knowledgeBase, intent, signal),
  };
}
