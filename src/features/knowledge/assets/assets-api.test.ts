import { describe, expect, test } from 'bun:test';
import { isKnowledgeDataError } from '../data/errors';
import { knowledgeTrpcUrl } from '../data/endpoint';
import { createKnowledgeAssetsApi } from './assets-api';

const origin = 'https://api.fob.example';
const knowledgeBase = '20000000-0000-4000-8000-000000000000';
const intent = {
  hash: 'a'.repeat(64),
  mime: 'text/plain',
  size: 3,
  name: '说明.txt',
};

type CapturedRequest = { url: string; method: string; body?: string };

/** 驱动真实 @trpc/client 链路;响应用 U01 权威的批量信封。 */
function capturingFetch(respond: () => { status: number; body: string }) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase(), body: typeof init?.body === 'string' ? init?.body : undefined });
    const { status, body } = respond();
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const uploadGrant = {
  action: 'upload',
  url: 'https://s3.internal/fob-knowledge/20000000-0000-4000-8000-000000000000/aaaa',
  method: 'PUT',
  headers: { 'content-type': 'text/plain' },
  expiresAt: '2026-09-26T12:00:00.000Z',
} as const;

const apiWith = (fetchImpl: typeof fetch) => createKnowledgeAssetsApi({ resolveOrigin: () => origin, fetchImpl });

describe('createKnowledgeAssetsApi · prepareUpload', () => {
  test('调用 asset.prepare 并透传完整意图,返回契约化的预签名授权', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: uploadGrant } }]) }));
    const prepared = await apiWith(fetchImpl).prepareUpload(knowledgeBase, intent);
    expect(prepared).toEqual(uploadGrant);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url.startsWith(knowledgeTrpcUrl(origin, knowledgeBase) + '/asset.prepare?')).toBe(true);
    // tRPC 批量体以索引为键装载各调用的输入。
    expect(JSON.parse(requests[0]!.body!)).toEqual({ 0: { knowledgeBaseId: knowledgeBase, ...intent } });
  });

  test('秒传响应 {action:"reuse"} 按契约通过', async () => {
    const { fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: { action: 'reuse' } } }]) }));
    expect(await apiWith(fetchImpl).prepareUpload(knowledgeBase, intent)).toEqual({ action: 'reuse' });
  });

  test('不符合契约的响应(缺 expiresAt)被拒绝为 UNAVAILABLE,绝不当作数据', async () => {
    const malformed = { action: 'upload', url: uploadGrant.url, method: 'PUT', headers: { 'content-type': 'text/plain' } };
    const { fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: malformed } }]) }));
    const error = await apiWith(fetchImpl).prepareUpload(knowledgeBase, intent).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('UNAVAILABLE');
  });

  test('路由未挂载(transport NOT_FOUND)归一化为 NOT_FOUND 域错误', async () => {
    const { fetchImpl } = capturingFetch(() => ({
      status: 404,
      body: JSON.stringify([{ error: { message: 'The requested operation was not found.', code: -32004, data: { code: 'NOT_FOUND', httpStatus: 404 } } }]),
    }));
    const error = await apiWith(fetchImpl).prepareUpload(knowledgeBase, intent).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('NOT_FOUND');
  });
});

describe('createKnowledgeAssetsApi · confirmUpload', () => {
  test('调用 asset.confirm 并返回确认结果(created 标记透传)', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: { status: 'ready', created: true } } }]) }));
    const confirmed = await apiWith(fetchImpl).confirmUpload(knowledgeBase, intent);
    expect(confirmed).toEqual({ status: 'ready', created: true });
    expect(requests[0]!.url.startsWith(knowledgeTrpcUrl(origin, knowledgeBase) + '/asset.confirm?')).toBe(true);
  });

  test('非法输入(哈希不是 64 位十六进制)在发请求前被拒绝', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: '[]' }));
    const error = await apiWith(fetchImpl).prepareUpload(knowledgeBase, { ...intent, hash: 'xyz' }).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('INVALID_REQUEST');
    expect(requests).toHaveLength(0);
  });
});
