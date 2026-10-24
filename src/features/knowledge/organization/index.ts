/**
 * O02 · KnowledgeBase / 成员 / 群组 / Teamspace 组织界面。
 *
 * 数据客户端与 hooks 一并从这里导出，供知识库应用接线（U02+）复用：
 * REST 路由见 backend/server/src/modules/knowledge/organization/http.ts。
 */

export { OrganizationPanel } from './organization-panel';
export { organizationClient } from '@/features/knowledge/organization/client';
export type { OrganizationClient } from '@/features/knowledge/organization/client';
export { organizationQueryKeys } from './keys';
