/**
 * AssetUploader 组件测试(U08 验收):happy-dom + createRoot + act,经真实
 * DOM 事件驱动 —— 隐藏 input 的 change、drop 拖放、按钮 click。端口注入假
 * tRPC API 与假传输,哈希走真实 hashBlobSha256(File.stream 在 Bun 下可用)。
 * 断言的是用户看见的闭环:进度语义、秒传标记、错误反馈与重试、取消。
 */

import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { AssetUploader } from './asset-uploader';
import type { UploadedAsset } from '../upload-machine';
import type { KnowledgeAssetsApi } from '../assets-api';
import type { AssetTransfer } from '../transfer';

let window: Window;
const roots: Root[] = [];

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame', 'Event', 'DataTransfer']) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
  }
});

const encoder = new TextEncoder();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const knowledgeBase = '20000000-0000-4000-8000-000000000000';

/** 可编程假 API:prepare 可按序切换结果,记录调用。 */
function scriptApi(options: { prepareResults: ('upload' | 'reuse' | 'fail')[]; uploadedHeaders: string[] }) {
  const calls: { kind: 'prepare' | 'confirm'; hash: string }[] = [];
  let index = 0;
  const api: KnowledgeAssetsApi = {
    async prepareUpload(_knowledgeBaseId, intent) {
      calls.push({ kind: 'prepare', hash: intent.hash });
      const outcome = options.prepareResults[Math.min(index, options.prepareResults.length - 1)] ?? 'upload';
      index += 1;
      if (outcome === 'fail') {
        const error = new Error('The requested operation was not found.') as Error & { data?: unknown; meta?: unknown };
        error.data = { code: 'NOT_FOUND', httpStatus: 404 };
        throw error;
      }
      if (outcome === 'reuse') return { action: 'reuse' };
      return { action: 'upload', url: 'https://s3.test/put', method: 'PUT', headers: { 'content-type': intent.mime }, expiresAt: '2026-09-26T12:10:00.000Z' };
    },
    async confirmUpload(_knowledgeBaseId, intent) {
      calls.push({ kind: 'confirm', hash: intent.hash });
      return { status: 'ready', created: true };
    },
    async download() { throw new Error('download is outside this upload fixture'); },
  };
  return { api, calls };
}

/** 假传输:可挂起(测取消)或立即完成并回报进度;记录 PUT 请求头。 */
function fakeTransfer(options: { hang?: boolean } = {}) {
  const puts: { url: string; header: string; bytes: Uint8Array }[] = [];
  const transfer: AssetTransfer = async (input) => {
    puts.push({ url: input.url, header: input.headers['content-type'], bytes: new Uint8Array(await input.body.arrayBuffer()) });
    if (options.hang) {
      await new Promise<void>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal!.reason), { once: true });
      });
      return;
    }
    input.onProgress?.(0.5);
    input.onProgress?.(1);
  };
  return { transfer, puts };
}

async function mountUploader(props: { api: KnowledgeAssetsApi; transfer: AssetTransfer; onUploaded?: (asset: UploadedAsset) => void }) {
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  roots.push(root);
  await act(async () => {
    root.render(<AssetUploader knowledgeBaseId={knowledgeBase} api={props.api} transfer={props.transfer} onUploaded={props.onUploaded} />);
  });
  return host as unknown as HTMLElement;
}

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

async function settle(assertion: () => void) {
  await act(async () => {
    await until(assertion);
  });
}

function buttonByLabel(host: HTMLElement, prefix: string): HTMLButtonElement {
  const match = host.querySelector(`[aria-label^="${prefix}"]`);
  if (!match) throw new Error(`button not found by label: ${prefix}`);
  return match as unknown as HTMLButtonElement;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(text));
  if (!match) throw new Error(`button not found: ${text}`);
  return match as unknown as HTMLButtonElement;
}

/** 经隐藏 input 触发选择文件(happy-dom 的 files 可通过 defineProperty 注入)。 */
function selectFiles(host: HTMLElement, files: File[]) {
  const input = host.querySelector('input[type="file"]') as unknown as HTMLInputElement;
  const list = { length: files.length, item: (index: number) => files[index], [Symbol.iterator]: function* () { yield* files; } };
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  act(() => {
    input.dispatchEvent(new window.Event('change', { bubbles: true }) as unknown as Event);
  });
}

function dropFiles(host: HTMLElement, files: File[]) {
  const zone = host.querySelector('[aria-describedby="asset-upload-hint"]') as unknown as HTMLElement;
  const fileList = { length: files.length, item: (index: number) => files[index], [Symbol.iterator]: function* () { yield* files; } };
  const dataTransfer = { types: ['Files'], files: fileList };
  for (const type of ['dragover', 'drop']) {
    const event = new window.Event(type, { bubbles: true, cancelable: true }) as unknown as Event & { dataTransfer?: unknown };
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer, configurable: true });
    act(() => {
      zone.dispatchEvent(event);
    });
  }
}

describe('AssetUploader · 组件闭环', () => {
  test('点选文件:完成上传与完整性确认,展示指纹', async () => {
    const { api, calls } = scriptApi({ prepareResults: ['upload'], uploadedHeaders: [] });
    const { transfer, puts } = fakeTransfer();
    const uploaded: UploadedAsset[] = [];
    const host = await mountUploader({ api, transfer, onUploaded: (asset) => uploaded.push(asset) });

    selectFiles(host, [new File([encoder.encode('组件全流程内容')], '验收.txt', { type: 'text/plain' })]);
    await settle(() => expect(host.textContent).toContain('已上传并通过完整性确认'));

    const hash = sha256('组件全流程内容');
    expect(host.textContent).toContain(hash.slice(0, 16));
    expect(puts).toHaveLength(1);
    expect(puts[0]!.header).toBe('text/plain');
    expect(calls.map((call) => call.kind)).toEqual(['prepare', 'confirm']);
    expect(uploaded).toEqual([{ hash, name: '验收.txt', mime: 'text/plain', size: encoder.encode('组件全流程内容').byteLength, reused: false, created: true }]);
  });

  test('拖拽加入文件可行,且上传中呈现进度条语义', async () => {
    const { api } = scriptApi({ prepareResults: ['upload'], uploadedHeaders: [] });
    let releaseTransfer!: () => void;
    const released = new Promise<void>((resolve) => { releaseTransfer = resolve; });
    const transfer: AssetTransfer = async (input) => {
      input.onProgress?.(0.4);
      await released;
      input.onProgress?.(1);
    };
    const host = await mountUploader({ api, transfer });

    dropFiles(host, [new File([encoder.encode('拖拽上传内容')], 'drop.txt', { type: 'text/plain' })]);
    await settle(() => {
      const bar = host.querySelector('[role="progressbar"]') as unknown as HTMLElement;
      expect(bar).toBeTruthy();
      expect(bar.getAttribute('aria-valuenow')).toBe('40');
    });
    expect(host.textContent).toContain('上传 40%');

    releaseTransfer();
    await settle(() => expect(host.textContent).toContain('已上传并通过完整性确认'));
  });

  test('秒传:呈现秒传命中且不发生 PUT', async () => {
    const { api, calls } = scriptApi({ prepareResults: ['reuse'], uploadedHeaders: [] });
    const { transfer, puts } = fakeTransfer();
    const host = await mountUploader({ api, transfer });

    selectFiles(host, [new File([encoder.encode('秒传内容')], 'dup.txt', { type: 'text/plain' })]);
    await settle(() => expect(host.textContent).toContain('秒传命中 · 知识库已有相同内容'));

    expect(puts).toHaveLength(0);
    expect(calls.map((call) => call.kind)).toEqual(['prepare']);
  });

  test('错误反馈与重试:prepare 未挂载失败 → 提示 + 重试按钮;重试后成功', async () => {
    const { api } = scriptApi({ prepareResults: ['fail', 'upload'], uploadedHeaders: [] });
    const { transfer } = fakeTransfer();
    const host = await mountUploader({ api, transfer });

    selectFiles(host, [new File([encoder.encode('重试组件内容')], 'retry.txt', { type: 'text/plain' })]);
    await settle(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('获取上传授权失败'));

    await act(async () => {
      buttonByLabel(host, "重试上传").click();
    });
    await settle(() => expect(host.textContent).toContain('已上传并通过完整性确认'));
    expect(host.textContent).toContain('第 2 次');
  });

  test('取消:传输挂起时点取消 → 已取消;再次重试可完成', async () => {
    const { api } = scriptApi({ prepareResults: ['upload', 'upload'], uploadedHeaders: [] });
    let hanging = true;
    const transfer: AssetTransfer = async (input) => {
      if (hanging) {
        await new Promise<void>((_resolve, reject) => {
          input.signal?.addEventListener('abort', () => reject(input.signal!.reason), { once: true });
        });
        return;
      }
      input.onProgress?.(1);
    };
    const host = await mountUploader({ api, transfer });

    selectFiles(host, [new File([encoder.encode('取消组件内容')], 'cancel.txt', { type: 'text/plain' })]);
    await settle(() => expect((host.querySelector('[aria-label^="取消上传"]') as unknown as HTMLButtonElement)).toBeTruthy());

    await act(async () => {
      (host.querySelector('[aria-label^="取消上传"]') as unknown as HTMLButtonElement).click();
    });
    await settle(() => expect(host.textContent).toContain('已取消;可重试继续上传。'));

    hanging = false;
    await act(async () => {
      buttonByLabel(host, "重试上传").click();
    });
    await settle(() => expect(host.textContent).toContain('已上传并通过完整性确认'));
  });

  test('契约预检:空文件立即呈现 FILE_INVALID,不发起任何请求', async () => {
    const { api, calls } = scriptApi({ prepareResults: ['upload'], uploadedHeaders: [] });
    const { transfer, puts } = fakeTransfer();
    const host = await mountUploader({ api, transfer });

    selectFiles(host, [new File([new Uint8Array(0)], 'empty.txt', { type: 'text/plain' })]);
    await settle(() => expect(host.textContent).toContain('文件不符合上传要求'));
    expect(calls).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  test('清除已完成与失败项', async () => {
    const { api } = scriptApi({ prepareResults: ['upload'], uploadedHeaders: [] });
    const { transfer } = fakeTransfer();
    const host = await mountUploader({ api, transfer });

    selectFiles(host, [new File([encoder.encode('清理内容')], 'clear.txt', { type: 'text/plain' })]);
    await settle(() => expect(host.textContent).toContain('已上传并通过完整性确认'));

    await act(async () => {
      buttonByText(host, "清除已完成").click();
    });
    expect(host.querySelectorAll('li')).toHaveLength(0);
  });
});
