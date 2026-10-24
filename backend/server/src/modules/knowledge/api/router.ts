import { pageScopeSchema, permissionLevelSchema, knowledgeBaseScopeSchema } from '@fob/shared/knowledge/contracts';
import { aiStreamingTaskSelectorSchema, startAiStreamingTaskInputSchema } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestContext } from '../access';
import { authorizePageAccess } from '../permissions';
import { knowledgeStreamingTasks, toKnowledgeStreamingTrpcError } from '../ai/streaming';
import type { KnowledgeStreamingTasks } from '../ai/streaming';
import { createKnowledgeRouter, knowledgeQuery, knowledgeMutation } from './procedures';
import { knowledgeCommentRouterRecord } from './comment-routes';
import { knowledgePageRouterRecord } from './page-routes';
import { knowledgeDatabaseRouterRecord } from './database-routes';
import { knowledgeAssetRouterRecord } from './asset-routes';
import type { KnowledgeProcedureContext } from './context';

/** Authenticated page metadata, ACL, comments and AI tasks. Body edits use Y.Doc. */
/** N02 (§4.6): the sidebar's comment thread lifecycle over the shared comment contracts. */
export const knowledgeApiRouter = createKnowledgeRouter({
  comment: knowledgeCommentRouterRecord,
  database: knowledgeDatabaseRouterRecord,
  asset: knowledgeAssetRouterRecord,
  access: knowledgeQuery({
    input: knowledgeBaseScopeSchema,
    scopes: ['read'],
    resolve: ({ ctx }) => ({
      knowledgeBaseId: ctx.authority.knowledgeBaseId,
      userId: ctx.authority.userId,
      role: ctx.authority.role,
      actor: ctx.authority.actor,
      credentialKind: ctx.authority.credential.kind,
      scopes: ctx.authority.scopes,
    }),
  }),
  page: {
    ...knowledgePageRouterRecord,
    /** One authorization per action. Denied, rebuilding and missing pages share one shape. */
    access: knowledgeQuery({
      input: pageScopeSchema.extend({ action: permissionLevelSchema }),
      scopes: ['read'],
      resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
        const decision = await authorizePageAccess(db, { userId: authority.userId, scope: { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId }, required: input.action });
        if (decision.decision !== 'allow') return { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId, authorized: false, level: null };
        return { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId, authorized: true, level: decision.level };
      }),
    }),
  },
  /**
   * J04 逐块流式 AI 任务（§9.3）。流式内容不经本边界传输——块写入共享 Y.Doc，
   * 客户端经协作通道实时看到逐块出现；这里只承载任务的发起、撤销与状态查询。
   * 服务实例由组合根装配并绑定（`bindKnowledgeStreamingTasks`），未绑定时
   * 返回 SERVICE_UNAVAILABLE。
   */
  aiTask: {
    start: knowledgeMutation({
      input: startAiStreamingTaskInputSchema,
      scopes: ['read', 'write'],
      resolve: ({ ctx, input }) => runStreamingTask(ctx.authority, (tasks) => tasks.start(ctx.authority, input)),
    }),
    cancel: knowledgeMutation({
      input: aiStreamingTaskSelectorSchema,
      scopes: ['read'],
      resolve: ({ ctx, input }) => runStreamingTask(ctx.authority, (tasks) => tasks.cancel(ctx.authority, input)),
    }),
    get: knowledgeQuery({
      input: aiStreamingTaskSelectorSchema,
      scopes: ['read'],
      resolve: ({ ctx, input }) => runStreamingTask(ctx.authority, (tasks) => tasks.get(ctx.authority, input)),
    }),
    revoke: knowledgeMutation({
      input: aiStreamingTaskSelectorSchema,
      scopes: ['read', 'write'],
      resolve: ({ ctx, input }) => runStreamingTask(ctx.authority, (tasks) => tasks.revoke(ctx.authority, input)),
    }),
  },
});

async function runStreamingTask<T>(authority: KnowledgeRequestContext, operation: (tasks: KnowledgeStreamingTasks) => Promise<T>): Promise<T> {
  try {
    return await operation(knowledgeStreamingTasks());
  } catch (error) {
    throw toKnowledgeStreamingTrpcError(error);
  }
}

export type KnowledgeApiRouter = typeof knowledgeApiRouter;
