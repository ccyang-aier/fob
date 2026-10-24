'use client';

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './transfer.messages';
const knowledgeT = createTranslator(knowledgeMessages);
/**
 * S3 预签名直传的浏览器传输端口(U08 · 设计 §8.1 第 3 步)。
 *
 * fetch 无法观测上传字节进度,预签名 PUT 用 XMLHttpRequest:`upload.onprogress`
 * 提供长度可计算的进度,`xhr.abort()` 提供取消。请求头原样使用 prepare 返回
 * 的义务清单(不自行增删)——签名覆盖的头部变化会直接 403。Body 传 File,
 * 浏览器以流式方式发送,不整体载入内存。
 */

export type AssetTransferErrorKind = 'network' | 'status';

export class AssetTransferError extends Error {
  readonly kind: AssetTransferErrorKind;
  readonly status: number | null;

  constructor(kind: AssetTransferErrorKind, status: number | null = null) {
    super(
      kind === 'network'
        ? knowledgeT('unableToConnectToObjectStorage')
        : knowledgeT('objectStorageRejectedTheUploadHttpValue', { v0: status ?? 'unknown' }),
    );
    this.name = 'AssetTransferError';
    this.kind = kind;
    this.status = status;
  }
}

export interface AssetTransferInput {
  url: string;
  method: 'PUT';
  headers: Readonly<{ 'content-type': string }>;
  body: Blob;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export type AssetTransfer = (input: AssetTransferInput) => Promise<void>;

/** XHR 不存在于非浏览器运行时(Bun 测试用注入的假传输);装配时才解析。 */
function assertXhr(): typeof XMLHttpRequest {
  if (typeof XMLHttpRequest === 'undefined')
    throw new Error(knowledgeT('xmlhttprequestIsUnavailableInThisRuntime'));
  return XMLHttpRequest;
}

export const xhrAssetTransfer: AssetTransfer = (input) =>
  new Promise<void>((resolve, reject) => {
    const Ctor = assertXhr();
    const xhr = new Ctor();
    let settled = false;
    const settle = (complete: () => void) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = () => {
      xhr.abort();
      settle(() =>
        reject(
          input.signal?.reason ?? new DOMException(knowledgeT('uploadCancelled'), 'AbortError'),
        ),
      );
    };

    xhr.open(input.method, input.url, true);
    for (const [name, value] of Object.entries(input.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        input.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () =>
      settle(() =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new AssetTransferError('status', xhr.status)),
      );
    xhr.onerror = () => settle(() => reject(new AssetTransferError('network')));
    xhr.onabort = () =>
      settle(() =>
        reject(
          input.signal?.reason ?? new DOMException(knowledgeT('uploadCancelled'), 'AbortError'),
        ),
      );
    xhr.ontimeout = () => settle(() => reject(new AssetTransferError('network')));
    input.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(input.body);
  });
