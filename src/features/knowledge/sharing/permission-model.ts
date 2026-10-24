import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './permission-model.messages';
/**
 * 权限与分享面板的纯模型(U05):级别序、授予/撤销可执行矩阵、
 * 有效权限解释文案(继承/默认/显式)与分享链接级别上限。
 */
export const permissionLevels = ['view', 'comment', 'edit', 'full'] as const;
export type PermissionLevel = (typeof permissionLevels)[number];

export const levelRank = (level: PermissionLevel): number => permissionLevels.indexOf(level);

export interface PrincipalGrant {
  principal: string;
  level: PermissionLevel;
}

/** 解析主体字符串('user:…'/'group:…'/'knowledgeBase:…'/'link:…')。 */
export function principalKind(
  principal: string,
): 'user' | 'group' | 'knowledgeBase' | 'link' | 'unknown' {
  const kind = principal.split(':')[0];
  return kind === 'user' || kind === 'group' || kind === 'knowledgeBase' || kind === 'link'
    ? kind
    : 'unknown';
}

/**
 * 授予校验:编辑者自身有效级别必须 ≥ 目标级别(P02/P03 语义:
 * 不能授予自己没有的权限);knowledgeBase 主体必须指向本空间。
 */
export function canGrant(
  grantorLevel: PermissionLevel | null,
  grant: PrincipalGrant,
  knowledgeBaseId: string,
): boolean {
  if (!grantorLevel) return false;
  if (levelRank(grantorLevel) < levelRank(grant.level)) return false;
  if (principalKind(grant.principal) === 'knowledgeBase')
    return grant.principal === `knowledgeBase:${knowledgeBaseId}`;
  return principalKind(grant.principal) !== 'unknown';
}

/** 撤销/降级同样要求 full 或 edit+ 且不低于被改级别;分享链接上限 comment。 */
export const shareLinkMaxLevel: PermissionLevel = 'comment';

export function canRevoke(actorLevel: PermissionLevel | null, target: PrincipalGrant): boolean {
  return !!actorLevel && levelRank(actorLevel) >= levelRank(target.level);
}

/** 有效权限解释:显式条目 > 断继承边界 > 团队空间根默认 > 继承链。 */
export function explainEffective(input: {
  explicit: readonly PrincipalGrant[];
  inheritsPermissions: boolean;
  rootDefault: PermissionLevel | null;
  inheritedGrants: readonly PrincipalGrant[];
}): {
  source: 'explicit' | 'root-default' | 'inherited' | 'none';
  grants: readonly PrincipalGrant[];
} {
  if (input.explicit.length) return { source: 'explicit', grants: input.explicit };
  if (!input.inheritsPermissions) return { source: 'none', grants: [] };
  if (input.rootDefault)
    return {
      source: 'root-default',
      grants: [{ principal: 'knowledgeBase', level: input.rootDefault }],
    };
  if (input.inheritedGrants.length) return { source: 'inherited', grants: input.inheritedGrants };
  return { source: 'none', grants: [] };
}

export function explainSourceCopy(
  locale?: Locale,
): Record<ReturnType<typeof explainEffective>['source'], string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    explicit: knowledgeT('explicitPagePermission'),
    'root-default': knowledgeT('folderDefaultAccess'),
    inherited: knowledgeT('inheritedFromParentPage'),
    none: knowledgeT('noAccessInheritanceDisabledAndNoExplicitGrants'),
  };
}

/** 变更计划:保存前的客户端校验产物(去重、排序、能力检查)。 */
export type SharePlan =
  | { ok: true; grants: PrincipalGrant[] }
  | { ok: false; reason: 'duplicate-principal' | 'beyond-grantor' | 'invalid-principal' };

export function planGrantChange(input: {
  current: readonly PrincipalGrant[];
  actorLevel: PermissionLevel | null;
  next: PrincipalGrant;
  knowledgeBaseId: string;
}): SharePlan {
  if (!canGrant(input.actorLevel, input.next, input.knowledgeBaseId)) {
    return input.actorLevel && principalKind(input.next.principal) !== 'unknown'
      ? { ok: false, reason: 'beyond-grantor' }
      : { ok: false, reason: 'invalid-principal' };
  }
  const merged = input.current.filter((grant) => grant.principal !== input.next.principal);
  if (!input.next.principal) return { ok: false, reason: 'invalid-principal' };
  if (
    merged.length === input.current.length &&
    input.current.some((grant) => grant.principal === input.next.principal)
  ) {
    // 同主体更新级别属于合法覆盖;真正的重复只可能来自同主体两条输入。
    if (
      input.current.some(
        (grant) => grant.principal === input.next.principal && grant.level === input.next.level,
      )
    ) {
      return { ok: false, reason: 'duplicate-principal' };
    }
  }
  merged.push(input.next);
  return { ok: true, grants: merged.sort((a, b) => a.principal.localeCompare(b.principal)) };
}
