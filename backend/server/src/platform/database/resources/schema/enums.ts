import { aiTaskSchema, assetStatusSchema, commentThreadStatusSchema, commentThreadKindSchema, commentAnchorKindSchema, modelTiers, outboxEventSchema, pageKindSchema, permissionLevels } from '@fob/shared/knowledge/contracts';
import { memberRoleSchema } from '@fob/shared/resources';
import { resourcesNamespace } from './namespaces';

// Zod exposes options as arrays; Drizzle requires a non-empty tuple. Keep enum
// values source-owned while using the PgEnum representation supported by Kit.
function values<T extends string>(options: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = options;
  if (first === undefined) throw new Error('A database enum must not be empty');
  return [first, ...rest];
}

export const memberRole = resourcesNamespace.enum('member_role', values(memberRoleSchema.options));
export const pageKind = resourcesNamespace.enum('page_kind', values(pageKindSchema.options));
export const permissionLevel = resourcesNamespace.enum('permission_level', permissionLevels);
export const modelTier = resourcesNamespace.enum('model_tier', modelTiers);
export const commentThreadStatus = resourcesNamespace.enum('comment_thread_status', values(commentThreadStatusSchema.options));
export const assetStatus = resourcesNamespace.enum('asset_status', values(assetStatusSchema.options));
export const aiTaskKind = resourcesNamespace.enum('ai_task_kind', values(aiTaskSchema.shape.kind.options));
export const aiTaskStatus = resourcesNamespace.enum('ai_task_status', values(aiTaskSchema.shape.status.options));

const topics = outboxEventSchema.options.map((option) => option.shape.topic.value);
export const outboxTopic = resourcesNamespace.enum('outbox_topic', values(topics));

export const commentThreadKind = resourcesNamespace.enum('comment_thread_kind', values(commentThreadKindSchema.options));
export const commentAnchorKind = resourcesNamespace.enum('comment_anchor_kind', values(commentAnchorKindSchema.options));
