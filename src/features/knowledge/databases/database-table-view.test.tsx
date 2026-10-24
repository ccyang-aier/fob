/**
 * DatabaseTableView 组件测试（U06）：真实 React 组件 + 真实 tRPC link 链 +
 * 有状态后端仿真（happy-dom），验证用户驱动的完整闭环——四态（加载 / 无权 /
 * 空 / 错误）、类型化单元格的乐观编辑与失败回滚、键盘导航契约、打开行正文、
 * 列删除与筛选触发的服务端重取。交互全部走真实 DOM 事件（act + click/键盘），
 * 传输经拦截全局 fetch 的仿真后端（U01 权威 tRPC 批信封 + O02 组织 REST），
 * 异步结算用真实时间轮询等待，不依赖固定刷新轮次。
 */

import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { Properties, PropertyDefinition } from '@fob/shared/knowledge/contracts';
import { DatabaseTableView } from './database-table-view';

let window: Window;
const roots: Root[] = [];

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame', 'PointerEvent', 'MouseEvent', 'KeyboardEvent']) {
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
  (globalThis as Record<string, unknown>).fetch = undefined;
});

const knowledgeBase = '20000000-0000-4000-8000-000000000000';
const database = '10000000-0000-4000-8000-00000000000d';
const rowA = '10000000-0000-4000-8000-0000000000e1';
const rowB = '10000000-0000-4000-8000-0000000000e2';
const member = { knowledgeBaseId: knowledgeBase, userId: '30000000-0000-4000-8000-000000000001', role: 'member' as const, name: '林澜', email: 'lin@fob.test', joinedAt: '2026-09-01T00:00:00Z' };

const columns: PropertyDefinition[] = [
  { id: 'c_title_x', name: '摘要', type: 'text' },
  { id: 'c_num', name: '数量', type: 'number' },
  { id: 'c_date', name: '截止', type: 'date' },
  { id: 'c_done', name: '完成', type: 'checkbox' },
  { id: 'c_status', name: '状态', type: 'select', options: [{ id: 'o_todo', label: '待办', color: 'blue' }, { id: 'o_done', label: '完成', color: 'green' }] },
  { id: 'c_tags', name: '标签', type: 'multiSelect', options: [{ id: 't_p1', label: 'P1', color: 'rose' }] },
  { id: 'c_owner', name: '负责人', type: 'person' },
];

const rows = (state: { title: string; properties: Properties }[]) =>
  state.map((row, index) => ({ pageId: index === 0 ? rowA : rowB, title: row.title, properties: row.properties }));

interface StubOptions {
  level?: 'view' | 'full';
  authorized?: boolean;
  columns?: PropertyDefinition[];
  rows?: ReturnType<typeof rows>;
  /** 注入一次性失败：过程名 -> tRPC 错误码。 */
  failOnce?: Map<string, string>;
}

/** 有状态仿真后端：页面授权、列 schema、行查询与行/列写入，全部经真实 URL 解析路由。 */
function stubBackend(options: StubOptions = {}) {
  const state = {
    level: options.level ?? 'full',
    authorized: options.authorized ?? true,
    columns: [...(options.columns ?? columns)],
    rows: [...(options.rows ?? rows([
      { title: '需求评审', properties: { c_title_x: '本周完成', c_num: 3, c_date: '2026-09-30', c_done: false, c_status: 'o_todo', c_tags: ['t_p1'], c_owner: [member.userId] } },
      { title: '发布准备', properties: { c_title_x: '检查单', c_num: 1, c_date: null, c_done: true, c_status: 'o_done', c_tags: [], c_owner: [] } },
    ]))],
    listRowsQueries: [] as Record<string, unknown>[],
    updateColumnsCalls: [] as PropertyDefinition[][],
    createdRows: [] as string[],
    /** 收到的 updateRowProperties 请求（含被 failOnce 拒绝的尝试——尝试即调用）。 */
    rowPropertiesCalls: [] as { pageId: string; properties: Properties }[],
  };
  const takeFailure = (procedure: string) => {
    const code = options.failOnce?.get(procedure);
    if (code) options.failOnce!.delete(procedure);
    return code;
  };
  const trpcError = (code: string) => new Response(JSON.stringify([{ error: { code: -32000, message: code, data: { code, httpStatus: 400, requestId: 'req-test' } } }]), { status: 404, headers: { 'content-type': 'application/json' } });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/members')) {
      return new Response(JSON.stringify({ items: [member], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // tRPC 批查询把多个过程名并到同一路径（a,b），input 以 "0"/"1" 索引；
    // 条目形态随传输与序列化器而定（直排对象或 {"json":…} 包装），两种都解。
    const procedures = (url.pathname.split('/').pop() ?? '').split(',').filter(Boolean);
    const unwrap = (entry: unknown): Record<string, unknown> =>
      ((entry && typeof entry === 'object' && 'json' in entry ? (entry as { json: Record<string, unknown> }).json : entry) as Record<string, unknown>) ?? {};
    const inputOf = (index: number): Record<string, unknown> => {
      if (init?.method === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        return unwrap(body[String(index)]);
      }
      const raw = url.searchParams.get('input');
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return unwrap(parsed[String(index)]);
    };
    const envelopeBody = (results: unknown[]) => new Response(JSON.stringify(results), { status: 200, headers: { 'content-type': 'application/json' } });

    // 注入失败的调用也算「发出过的请求」：先记尝试，再短路返回错误。
    const failure = procedures
      .map((procedure, index) => {
        const code = takeFailure(procedure);
        if (code && procedure === 'database.updateRowProperties') {
          const query = inputOf(index);
          state.rowPropertiesCalls.push({ pageId: query.pageId as string, properties: query.properties as Properties });
        }
        return code;
      })
      .find(Boolean);
    if (failure) return trpcError(failure);

    const respondProcedure = (name: string, query: Record<string, unknown>): unknown => {
      switch (name) {
        case 'page.access':
          return { result: { data: { knowledgeBaseId: knowledgeBase, pageId: database, authorized: state.authorized, level: state.authorized ? state.level : null } } };
        case 'database.getColumns':
          return { result: { data: { knowledgeBaseId: knowledgeBase, pageId: database, columns: state.columns } } };
        case 'database.listRows':
          state.listRowsQueries.push(query);
          return { result: { data: { rows: state.rows, nextCursor: null } } };
        case 'database.updateRowProperties':
          state.rowPropertiesCalls.push({ pageId: query.pageId as string, properties: query.properties as Properties });
          state.rows = state.rows.map((row) => (row.pageId === query.pageId ? { ...row, properties: query.properties as Properties } : row));
          return { result: { data: { knowledgeBaseId: knowledgeBase, pageId: query.pageId, properties: query.properties } } };
        case 'database.createRow':
          state.createdRows.push(query.id as string);
          state.rows = [...state.rows, { pageId: query.id as string, title: query.title as string, properties: query.properties as Properties }];
          return { result: { data: { pageId: query.id, parentId: database, teamspaceId: 'a0000000-0000-4000-8000-00000000000a', position: 'i00000', path: 'p' } } };
        case 'database.updateColumns':
          state.columns = query.columns as PropertyDefinition[];
          state.updateColumnsCalls.push(state.columns);
          return { result: { data: { knowledgeBaseId: knowledgeBase, pageId: database, columns: state.columns } } };
        default:
          return { error: { code: -32001, message: 'not found', data: { code: 'NOT_FOUND', httpStatus: 404, requestId: 'req-x' } } };
      }
    };

    if (procedures.length > 1) {
      return envelopeBody(procedures.map((procedure, index) => respondProcedure(procedure, inputOf(index))));
    }
    const procedure = procedures[0] ?? '';
    const single = respondProcedure(procedure, inputOf(0)) as Record<string, unknown>;
    if ('error' in single) {
      return new Response(JSON.stringify([single]), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return envelopeBody([single]);
  }) as typeof fetch;
  (globalThis as Record<string, unknown>).fetch = fetchImpl;
  return state;
}

async function mountView(onOpenRow: (pageId: string) => void = () => undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <DatabaseTableView scope={{ knowledgeBaseId: knowledgeBase, pageId: database }} title="迭代任务库" onOpenRow={onOpenRow} />
      </QueryClientProvider>,
    );
  });
  return { host: host as unknown as HTMLElement, queryClient };
}

/** 真实时间轮询直到谓词成立（查询 / 乐观回路的异步结算不依赖固定刷新轮次）。 */
async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`until() timed out after ${timeoutMs}ms`);
}

const textOf = (host: HTMLElement) => host.textContent ?? '';
/** 全局 DOM 作用域：锚定浮层 portal 到 overlay 根（document.body 下），宿主树之外的查询走 document。 */
const documentScope = () => (globalThis as unknown as { document: Document }).document;
// Document.textContent 恒为 null（DOM 规范），全局文本要读 body。
const allText = () => documentScope().body?.textContent ?? '';
const buttonByText = (scope: ParentNode, label: string) =>
  Array.from(scope.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label')?.includes(label));

/** happy-dom 的事件类与 lib.dom 结构类型不互通（运行时同一批对象），统一断言后派发。 */
const domEvent = (event: unknown): Event => event as Event;

async function click(node: Element) {
  await act(async () => {
    node.dispatchEvent(domEvent(new window.MouseEvent('click', { bubbles: true })));
  });
}

async function press(node: Element, key: string) {
  await act(async () => {
    node.dispatchEvent(domEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })));
  });
}

/**
 * React 受控输入需要原生 setter 赋值，React 的 value tracker 才会把事件视为变更；
 * 此外本进程的 react-dom 在 DOM 全局装好前完成模块求值，ChangeEventPlugin 走
 * 「input 事件不可信」的老 polyfill 路径——变更检测挂在 keyup/keydown 上——
 * 所以补一发 keyup（浏览器里用户键入后 keyup 本就随之而来），onChange 才会带
 * 新值触发。
 */
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(domEvent(new window.Event('input', { bubbles: true })));
    input.dispatchEvent(domEvent(new window.KeyboardEvent('keyup', { key: 'a', bubbles: true })));
  });
}

describe('DatabaseTableView · 四态', () => {
  test('无权：page.access 拒绝后呈现 forbidden，不发起任何数据库查询', async () => {
    const state = stubBackend({ authorized: false });
    const { host } = await mountView();
    await until(() => textOf(host).includes('没有该数据库的访问权限'));
    expect(state.listRowsQueries).toHaveLength(0);
  });

  test('错误：数据库服务错误如实呈现并可重试恢复', async () => {
    const failOnce = new Map([['database.getColumns', 'UNAVAILABLE']]);
    stubBackend({ failOnce });
    const { host } = await mountView();
    await until(() => textOf(host).includes('数据库加载失败'));
    expect(textOf(host)).toContain('知识服务暂时不可用');
    const retry = buttonByText(host, '重试');
    expect(retry).toBeDefined();
    await click(retry!);
    await until(() => textOf(host).includes('需求评审'));
  });

  test('空：无行数据库呈现空态引导，新建第一行走 createRow 并出现新行', async () => {
    const state = stubBackend({ rows: [] });
    const { host } = await mountView();
    await until(() => textOf(host).includes('这个数据库还没有行'));
    await click(buttonByText(host, '新建第一行')!);
    await until(() => state.createdRows.length === 1);
    expect(state.createdRows[0]).toMatch(/^[0-9a-f-]{36}$/);
    await until(() => !textOf(host).includes('这个数据库还没有行'));
  });

  test('加载：授权未回时呈现确认态，不伪造任何行', async () => {
    stubBackend();
    const { host } = await mountView();
    expect(textOf(host)).toContain('正在确认页面访问');
    expect(host.querySelector('[role="gridcell"]')).toBeNull();
    await until(() => textOf(host).includes('需求评审'));
  });
});

describe('DatabaseTableView · 类型化行渲染与行正文', () => {
  test('七类列按类型渲染（文本/数字/日期/复选/单选/多选/人员）', async () => {
    stubBackend();
    const { host } = await mountView();
    await until(() => textOf(host).includes('需求评审'));
    expect(textOf(host)).toContain('本周完成');
    expect(textOf(host)).toContain('2026-09-30');
    expect(textOf(host)).toContain('待办');
    expect(textOf(host)).toContain('P1');
    expect(textOf(host)).toContain('林澜');
    expect(textOf(host)).toContain('发布准备');
  });

  test('点击行名进入行正文（行是页面）', async () => {
    stubBackend();
    const opened: string[] = [];
    const { host } = await mountView((pageId) => opened.push(pageId));
    await until(() => textOf(host).includes('需求评审'));
    const titleButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('需求评审'));
    await click(titleButton!);
    expect(opened).toEqual([rowA]);
  });

  test('view 级权限：只读徽标呈现，单元格不进入编辑、新行入口隐藏', async () => {
    stubBackend({ level: 'view' });
    const { host } = await mountView();
    await until(() => textOf(host).includes('需求评审'));
    expect(textOf(host)).toContain('只读');
    expect(buttonByText(host, '新行')).toBeUndefined();
    const cell = Array.from(host.querySelectorAll('[role="gridcell"]')).find((element) => element.textContent?.includes('本周完成'))!;
    await click(cell);
    expect(host.querySelector('input[aria-label="编辑 摘要"]')).toBeNull();
  });
});

describe('DatabaseTableView · 单元格编辑闭环', () => {
  async function openCellEditor(host: HTMLElement, cellText: string, label: string) {
    const cell = Array.from(host.querySelectorAll('[role="gridcell"]')).find((element) => element.textContent?.includes(cellText))!;
    await click(cell);
    const input = host.querySelector(`input[aria-label="编辑 ${label}"]`) as HTMLInputElement;
    expect(input).not.toBeNull();
    return input;
  }

  test('文本单元格：点击进入编辑、Enter 提交、服务端确认后保持', async () => {
    const state = stubBackend();
    const { host } = await mountView();
    await until(() => textOf(host).includes('本周完成'));
    const input = await openCellEditor(host, '本周完成', '摘要');
    await type(input, '下周完成');
    await press(input, 'Enter');
    await until(() => textOf(host).includes('下周完成'));
    // 乐观补丁即时上屏，写请求异步结算——等到它到达服务端再校验内容。
    await until(() => state.rowPropertiesCalls.length === 1);
    expect((state.rowPropertiesCalls[0]!.properties as Record<string, unknown>).c_title_x).toBe('下周完成');
  });

  test('失败回滚与失败横幅；Esc 取消不动值也不发写请求', async () => {
    const failOnce = new Map([['database.updateRowProperties', 'FORBIDDEN']]);
    const state = stubBackend({ failOnce });
    const { host } = await mountView();
    await until(() => textOf(host).includes('本周完成'));

    const input = await openCellEditor(host, '本周完成', '摘要');
    await type(input, '被拒绝的修改');
    await press(input, 'Enter');
    await until(() => textOf(host).includes('编辑单元格失败（FORBIDDEN）'));
    expect(textOf(host)).toContain('本周完成');
    expect(textOf(host)).not.toContain('被拒绝的修改');
    expect(textOf(host)).toContain('已恢复到操作前的值');

    // Esc：取消编辑，不产生任何写请求。
    const input2 = await openCellEditor(host, '检查单', '摘要');
    await type(input2, '不应保存');
    await press(input2, 'Escape');
    await until(() => host.querySelector('input[aria-label="编辑 摘要"]') === null);
    expect(textOf(host)).toContain('检查单');
    expect(textOf(host)).not.toContain('不应保存');
    expect(state.rowPropertiesCalls).toHaveLength(1);
  });

  test('复选框单元格：Space 直接切换布尔值', async () => {
    const state = stubBackend();
    const { host } = await mountView();
    await until(() => textOf(host).includes('需求评审'));
    const doneCell = Array.from(host.querySelectorAll('[role="gridcell"][aria-colindex="5"]'))[0]! as HTMLElement;
    await act(async () => { doneCell.focus(); });
    await press(doneCell, ' ');
    await until(() => (state.rows.find((row) => row.pageId === rowA)!.properties as Record<string, unknown>).c_done === true);
  });

  test('非法数字输入就地拒绝，不发起写请求', async () => {
    const state = stubBackend();
    const { host } = await mountView();
    await until(() => textOf(host).includes('需求评审'));
    const numCell = Array.from(host.querySelectorAll('[role="gridcell"][aria-colindex="3"]'))[0]!;
    await click(numCell);
    const input = host.querySelector('input[aria-label="编辑 数量"]') as HTMLInputElement;
    await type(input, '不是数字');
    await press(input, 'Enter');
    await until(() => textOf(host).includes('请输入有效数字'));
    expect(state.rowPropertiesCalls).toHaveLength(0);
    expect(state.rows.find((row) => row.pageId === rowA)!.properties.c_num).toBe(3);
  });

  test('单选单元格：选项面板挑选后按列声明写入', async () => {
    const state = stubBackend();
    const { host } = await mountView();
    await until(() => textOf(host).includes('需求评审'));
    const statusCell = Array.from(host.querySelectorAll('[role="gridcell"]')).find((element) => element.textContent?.includes('待办'))!;
    await click(statusCell);
    const option = () => Array.from(documentScope().querySelectorAll('[role="option"]'))
      .find((element) => element.textContent?.includes('完成'));
    await until(() => option() !== undefined);
    await click(option()!);
    await until(() => (state.rows.find((row) => row.pageId === rowA)!.properties as Record<string, unknown>).c_status === 'o_done');
  });
});

describe('DatabaseTableView · 键盘导航', () => {
  test('方向键移动活动单元格、Tab 在行尾环绕、Enter 在行名列打开行正文', async () => {
    stubBackend();
    const opened: string[] = [];
    const { host } = await mountView((pageId) => opened.push(pageId));
    await until(() => textOf(host).includes('需求评审'));
    const cells = () => Array.from(host.querySelectorAll('[role="gridcell"], [role="rowheader"]'));
    const cellAt = (row: number, column: number) =>
      cells().find((element) => element.parentElement?.getAttribute('aria-rowindex') === String(row + 2) && element.getAttribute('aria-colindex') === String(column + 1)) as HTMLElement;
    // happy-dom 的 activeElement 类型与 lib.dom 元素不同源，运行时是同一对象，经统一断言比较。
    const active = () => window.document.activeElement as unknown as HTMLElement;

    const first = cellAt(0, 1);
    await act(async () => { first.focus(); });
    expect(active() === first).toBe(true);
    await press(first, 'ArrowDown');
    expect(active() === cellAt(1, 1)).toBe(true);
    await press(cellAt(1, 1), 'ArrowRight');
    expect(active() === cellAt(1, 2)).toBe(true);
    // 越界即停：首列左移停在行名列。
    await act(async () => { cellAt(1, 0).focus(); });
    await press(cellAt(1, 0), 'ArrowLeft');
    expect(active() === cellAt(1, 0)).toBe(true);
    // 末列 Tab 环绕到下一行行名列。
    await act(async () => { cellAt(0, 7).focus(); });
    await press(cellAt(0, 7), 'Tab');
    expect(active() === cellAt(1, 0)).toBe(true);
    // 行名列 Enter 打开行正文。
    const titleCell = cellAt(0, 0);
    await act(async () => { titleCell.focus(); });
    await press(titleCell, 'Enter');
    expect(opened).toEqual([rowA]);
  });
});

describe('DatabaseTableView · 列与筛选', () => {
  test('列头菜单删除列：两步确认后 updateColumns 收到无该列的整体替换', async () => {
    const state = stubBackend();
    const { host } = await mountView();
    await until(() => textOf(host).includes('需求评审'));
    const headerButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('截止'));
    await click(headerButton!);
    await until(() => allText().includes('按此列升序'));
    const deleteItem = Array.from(documentScope().querySelectorAll('[role="menuitem"]')).find((element) => element.textContent?.includes('删除列'));
    await click(deleteItem!);
    await until(() => allText().includes('会同时移除'));
    const confirm = Array.from(documentScope().querySelectorAll('button')).find((button) => button.textContent === '删除列');
    await click(confirm!);
    await until(() => state.updateColumnsCalls.length === 1);
    expect(state.updateColumnsCalls[0]!.map((column) => column.id)).not.toContain('c_date');
    await until(() => !textOf(host).includes('2026-09-30'));
  });

  test('筛选面板：构建契约筛选后触发带 filter 的服务端重取', async () => {
    const state = stubBackend();
    const { host } = await mountView();
    await until(() => textOf(host).includes('需求评审'));
    await click(buttonByText(host, '筛选')!);
    await until(() => documentScope().querySelectorAll('select').length >= 2);
    const selects = () => Array.from(documentScope().querySelectorAll('select')) as HTMLSelectElement[];
    await act(async () => {
      selects()[0]!.value = 'c_status';
      selects()[0]!.dispatchEvent(domEvent(new window.Event('change', { bubbles: true })));
    });
    await act(async () => {
      const operator = selects()[1]!;
      operator.value = 'eq';
      operator.dispatchEvent(domEvent(new window.Event('change', { bubbles: true })));
    });
    await until(() => selects().length >= 3);
    await act(async () => {
      const value = selects()[2]!;
      value.value = 'o_todo';
      value.dispatchEvent(domEvent(new window.Event('change', { bubbles: true })));
    });
    await click(buttonByText(documentScope(), '添加筛选')!);
    await until(() => textOf(host).includes('等于'));
    expect(textOf(host)).toContain('待办');
    // 芯片即时出现，带筛选的服务端重取是异步结算——等到它真的发出再断言内容。
    await until(() => {
      const last = state.listRowsQueries[state.listRowsQueries.length - 1] as { filters?: unknown[] } | undefined;
      return Array.isArray(last?.filters) && last.filters.length === 1;
    });
    const lastQuery = state.listRowsQueries[state.listRowsQueries.length - 1] as { filters?: { propertyId: string; operator: string; value?: string }[] };
    expect(lastQuery.filters).toEqual([{ propertyId: 'c_status', operator: 'eq', value: 'o_todo' }]);
  });
});
