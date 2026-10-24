'use client';

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './assets-api.messages';

/**
 * 资产上传的客户端 API 面(U08 · 设计 §8.1 第 2/5 步)。
 *
 * 只承载两个 tRPC 过程:`asset.prepare`(哈希探测 → 秒传或预签名 PUT)与
 * `asset.confirm`(完整性确认闭环,服务端按实际对象校验哈希/大小/类型并
 * 原子写 asset.created)。S3 直传不经过本层 —— 由传输端口直接 PUT 预签名
 * URL。路由由后端 API 任务装配;未装配时每个调用以传输层的 NOT_FOUND 诚
 * 实失败,绝不伪造成功。
 *
 * 沿用 pages-api 的 U03 模式:U01 路由类型尚未列出这些过程,调用走 tRPC
 * 客户端的动态 mutation 入口,输入与响应都在边界上用共享 zod 契约复验 ——
 * 类型安全来自契约,而非对线路的信任。
 */

import {
  assetConfirmResultSchema,
  assetDownloadResultSchema,
  uploadIntentSchema,
} from '@fob/shared/knowledge/contracts';
import type {
  AssetConfirmResult,
  AssetDownloadResult,
  AssetUploadPrepareResult,
} from '@fob/shared/knowledge/contracts';
import { assetUploadPrepareResultSchema } from '@fob/shared/knowledge/contracts';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { KnowledgeDataError, normalizeKnowledgeError } from '../data/errors';
import {
  createKnowledgeUntypedClientCache,
  type KnowledgeFetch,
  type KnowledgeUntypedTrpcClient,
} from '../data/trpc-client';

const knowledgeT = createTranslator(knowledgeMessages);

/** 客户端单文件的申报意图:`uploadIntentSchema` 去掉 knowledgeBaseId(随调用携带)。 */
export interface AssetIntentInput {
  hash: string;
  mime: string;
  size: number;
  name: string;
}

export type KnowledgeAssetsApi = {
  /** `asset.prepare`:同知识库同哈希 → `{action:'reuse'}`(秒传),否则预签名 PUT。 */
  prepareUpload(
    knowledgeBaseId: string,
    intent: AssetIntentInput,
    signal?: AbortSignal,
  ): Promise<AssetUploadPrepareResult>;
  /** `asset.confirm`:服务端按实际存储对象复验哈希/大小/类型后落库并出 asset.created。 */
  confirmUpload(
    knowledgeBaseId: string,
    intent: AssetIntentInput,
    signal?: AbortSignal,
  ): Promise<AssetConfirmResult>;
  download(
    knowledgeBaseId: string,
    hash: string,
    signal?: AbortSignal,
  ): Promise<AssetDownloadResult>;
};

function assertIntent(intent: AssetIntentInput, procedure: string): void {
  if (!uploadIntentSchema.omit({ knowledgeBaseId: true }).safeParse(intent).success) {
    throw new KnowledgeDataError('INVALID_REQUEST', {
      message: knowledgeT('invalidAssetUploadInputForValue', { v0: procedure }),
    });
  }
}

/** 响应被共享契约拒绝即视为服务不可用,绝不把未验证的数据当结果。 */
function parsePayload<T>(
  schema: { safeParse(payload: unknown): { success: true; data: T } | { success: false } },
  payload: unknown,
  procedure: string,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new KnowledgeDataError('UNAVAILABLE', {
      message: knowledgeT('invalidResponseFromAssetServiceValue', { v0: procedure }),
    });
  }
  return parsed.data;
}

export function createKnowledgeAssetsApi(deps: {
  resolveOrigin: () => Promise<string> | string;
  fetchImpl?: KnowledgeFetch;
}): KnowledgeAssetsApi {
  const cache = createKnowledgeUntypedClientCache(deps.fetchImpl);
  const run = async <T>(
    knowledgeBaseId: string,
    signal: AbortSignal | undefined,
    invoke: (client: KnowledgeUntypedTrpcClient) => Promise<T>,
  ): Promise<T> => {
    try {
      return await invoke(cache.get(await deps.resolveOrigin(), knowledgeBaseId));
    } catch (cause) {
      throw normalizeKnowledgeError(cause, signal);
    }
  };

  return {
    async prepareUpload(knowledgeBaseId, intent, signal) {
      assertIntent(intent, 'asset.prepare');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('asset.prepare', { knowledgeBaseId, ...intent }, { signal }),
      );
      return parsePayload(assetUploadPrepareResultSchema, payload, 'asset.prepare');
    },
    async confirmUpload(knowledgeBaseId, intent, signal) {
      assertIntent(intent, 'asset.confirm');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('asset.confirm', { knowledgeBaseId, ...intent }, { signal }),
      );
      return parsePayload(assetConfirmResultSchema, payload, 'asset.confirm');
    },
    async download(knowledgeBaseId, hash, signal) {
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.query('asset.download', { knowledgeBaseId, hash }, { signal }),
      );
      return parsePayload(assetDownloadResultSchema, payload, 'asset.download');
    },
  };
}

/** 浏览器装配:U01 端点解析器 + 全局 fetch;测试注入自己的传输。 */
export const knowledgeAssetsApi = createKnowledgeAssetsApi({
  resolveOrigin: async () => (await getFobApiOrigin()).origin,
});
