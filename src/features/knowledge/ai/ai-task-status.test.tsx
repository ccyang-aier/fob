/**
 * AiTaskStatus 组件测试（J04）：happy-dom + createRoot + act，经真实 DOM 事件
 * 驱动。断言用户看见的闭环：运行中呈现逐块进度并提供「取消」，终态且有已写
 * 建议块时提供「整体撤销」，已撤销/零块不再提供，pending 期间按钮禁用；
 * `aiTaskStatusView` 的状态→语气映射逐项覆盖。
 */

import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { AiStreamingTaskSnapshot } from '@fob/shared/knowledge/contracts';
import { AiTaskStatus, aiTaskStatusView } from './ai-task-status';

let window: Window;
const roots: Root[] = [];

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) {
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

const base = {
  knowledgeBaseId: '10000000-0000-4000-8000-000000000000',
  taskId: '30000000-0000-4000-8000-000000000000',
  pageId: '20000000-0000-4000-8000-000000000000',
  initiatedBy: '40000000-0000-4000-8000-000000000000',
  blocksWritten: 2,
  charsWritten: 128,
  errorCode: null,
  startedAt: '2026-09-26T08:00:00.000Z',
  updatedAt: '2026-09-26T08:00:01.000Z',
  revokedAt: null,
} as const satisfies Omit<AiStreamingTaskSnapshot, 'status'>;

const snapshot = (status: AiStreamingTaskSnapshot['status'], overrides: Partial<AiStreamingTaskSnapshot> = {}): AiStreamingTaskSnapshot =>
  ({ ...base, status, ...overrides });

interface MountOptions { pending?: boolean }

async function renderStatus(snapshot: AiStreamingTaskSnapshot, options: MountOptions = {}) {
  const clicks: string[] = [];
  const element = window.document.createElement('span');
  window.document.body.append(element);
  const root = createRoot(element as unknown as HTMLElement);
  roots.push(root);
  await act(async () => {
    root.render(
      <AiTaskStatus
        snapshot={snapshot}
        actions={{
          onCancel: () => { clicks.push('cancel'); },
          onRevoke: () => { clicks.push('revoke'); },
          pending: options.pending ?? false,
        }}
      />,
    );
  });
  const text = () => element.querySelector('[role="status"]')!.textContent ?? '';
  const button = (label: string) => [...element.querySelectorAll('button')].find((item) => item.textContent?.includes(label));
  return { clicks, text, button };
}

describe('aiTaskStatusView', () => {
  test('maps every status to a tone with progress accounting', () => {
    expect(aiTaskStatusView(snapshot('running'))).toMatchObject({ tone: 'progress', busy: true });
    expect(aiTaskStatusView(snapshot('running')).label).toContain('2 块');
    expect(aiTaskStatusView(snapshot('done'))).toMatchObject({ tone: 'ok', busy: false });
    expect(aiTaskStatusView(snapshot('cancelled'))).toMatchObject({ tone: 'warn', busy: false });
    const failed = aiTaskStatusView(snapshot('failed', { errorCode: 'provider_unavailable', blocksWritten: 1 }));
    expect(failed).toMatchObject({ tone: 'error', busy: false });
    expect(failed.label).toContain('provider_unavailable');
    expect(failed.hint).toContain('1 块');
  });
});

describe('AiTaskStatus', () => {
  test('running shows block progress and a working cancel button', async () => {
    const view = await renderStatus(snapshot('running', { blocksWritten: 3, charsWritten: 90 }));
    expect(view.text()).toContain('AI 生成中');
    expect(view.text()).toContain('3 块');
    expect(view.button('取消')).toBeTruthy();
    expect(view.button('撤销任务')).toBeFalsy();
    await act(async () => { view.button('取消')!.click(); });
    expect(view.clicks).toEqual(['cancel']);
  });

  test('cancelled keeps partial results reviewable and offers whole-task revoke', async () => {
    const view = await renderStatus(snapshot('cancelled', { blocksWritten: 1, charsWritten: 30 }));
    expect(view.text()).toContain('已取消');
    expect(view.text()).toContain('1 块');
    await act(async () => { view.button('撤销任务')!.click(); });
    expect(view.clicks).toEqual(['revoke']);
  });

  test('revoke disappears once the task is revoked or nothing was written', async () => {
    const revoked = await renderStatus(snapshot('done', { revokedAt: '2026-09-26T08:00:05.000Z' }));
    expect(revoked.button('撤销任务')).toBeFalsy();
    const empty = await renderStatus(snapshot('failed', { blocksWritten: 0, errorCode: 'provider_unavailable' }));
    expect(empty.button('撤销任务')).toBeFalsy();
  });

  test('pending disables actions while a request is in flight', async () => {
    const view = await renderStatus(snapshot('running'), { pending: true });
    const cancel = view.button('取消')!;
    expect(cancel.disabled).toBe(true);
    await act(async () => { cancel.click(); });
    expect(view.clicks).toEqual([]);
  });
});
