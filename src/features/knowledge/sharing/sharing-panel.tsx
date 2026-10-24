'use client';

import { formatDate, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './sharing-panel.messages';
/**
 * 页面权限与分享管理面板(U05):显式授权编辑(view..full,级别不超过
 * 操作者)、继承开关(断开/恢复并说明重算)、有效权限解释、分享链接
 * 创建/撤销(令牌仅创建时展示一次)。后端路由由 Z03 装配;面板经注入的
 * api 操作,未装配时呈现端点错误,不伪造成功。
 */
import { useMemo, useReducer, useState } from 'react';
import { AppAlert } from '@/components/app-alert';
import {
  canGrant,
  canRevoke,
  explainEffective,
  explainSourceCopy,
  levelRank,
  permissionLevels,
  planGrantChange,
  principalKind,
} from './permission-model';
import type { PermissionLevel, PrincipalGrant } from './permission-model';
import type { KnowledgeUiMessage } from '../ui-message';
import { permissionLevelLabel } from '../editor/editor-state';

type SharingMessage = KnowledgeUiMessage<typeof knowledgeMessages>;

export interface SharingApi {
  saveGrants(pageId: string, grants: PrincipalGrant[]): Promise<void>;
  setInheritance(pageId: string, inherits: boolean): Promise<void>;
  createLink(
    pageId: string,
    level: PermissionLevel,
    expiresInDays: number | null,
  ): Promise<{ token: string; linkId: string }>;
  revokeLink(linkId: string): Promise<void>;
}

export interface SharingPanelProps {
  pageId: string;
  knowledgeBaseId: string;
  actorLevel: PermissionLevel | null;
  rootDefault: PermissionLevel | null;
  explicit: readonly PrincipalGrant[];
  inheritedGrants: readonly PrincipalGrant[];
  inheritsPermissions: boolean;
  links: readonly {
    linkId: string;
    level: PermissionLevel;
    revoked: boolean;
    expiresAt: string | null;
  }[];
  api: SharingApi;
  onSaved: () => void;
}

interface State {
  grants: PrincipalGrant[];
  inherits: boolean;
  busy: boolean;
  error: string | SharingMessage | null;
  freshToken: { linkId: string; token: string } | null;
}

type Action =
  | { type: 'edit' }
  | { type: 'grant'; grant: PrincipalGrant }
  | { type: 'revoke-principal'; principal: string }
  | { type: 'inherit'; value: boolean }
  | { type: 'busy' }
  | { type: 'failed'; reason: string | SharingMessage }
  | { type: 'saved'; grants: PrincipalGrant[]; inherits: boolean }
  | { type: 'token'; linkId: string; token: string };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'edit':
      return state;
    case 'grant':
      return {
        ...state,
        grants: [
          ...state.grants.filter((g) => g.principal !== action.grant.principal),
          action.grant,
        ],
      };
    case 'revoke-principal':
      return { ...state, grants: state.grants.filter((g) => g.principal !== action.principal) };
    case 'inherit':
      return { ...state, inherits: action.value };
    case 'busy':
      return { ...state, busy: true, error: null };
    case 'failed':
      return { ...state, busy: false, error: action.reason };
    case 'saved':
      return {
        ...state,
        busy: false,
        grants: action.grants,
        inherits: action.inherits,
        freshToken: null,
      };
    case 'token':
      return { ...state, busy: false, freshToken: { linkId: action.linkId, token: action.token } };
  }
};

const errorKeys = {
  FORBIDDEN: 'youLackThePermissionRequiredForThisAction',
  TARGET_NOT_ACCESSIBLE: 'targetIsUnavailableOrDoesNotExist',
  UNAVAILABLE: 'serviceUnavailableRetryLater',
} as const;

export function SharingPanel(props: SharingPanelProps) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const [state, dispatch] = useReducer(reducer, {
    grants: [...props.explicit],
    inherits: props.inheritsPermissions,
    busy: false,
    error: null,
    freshToken: null,
  });
  const [principal, setPrincipal] = useState('');
  const [level, setLevel] = useState<PermissionLevel>('view');
  const [linkLevel, setLinkLevel] = useState<PermissionLevel>('view');
  const effective = useMemo(
    () =>
      explainEffective({
        explicit: state.grants,
        inheritsPermissions: state.inherits,
        rootDefault: props.rootDefault,
        inheritedGrants: props.inheritedGrants,
      }),
    [state.grants, state.inherits, props.rootDefault, props.inheritedGrants],
  );
  const writable =
    props.actorLevel === 'full' ||
    (props.actorLevel !== null && levelRank(props.actorLevel) >= levelRank('edit'));

  const run = async (action: () => Promise<void>) => {
    dispatch({ type: 'busy' });
    try {
      await action();
    } catch (error) {
      const key =
        error instanceof Error
          ? errorKeys[error.message as keyof typeof errorKeys]
          : errorKeys.UNAVAILABLE;
      dispatch({ type: 'failed', reason: key ? { key } : (error as Error).message });
    }
  };

  const addGrant = () => {
    const plan = planGrantChange({
      current: state.grants,
      actorLevel: props.actorLevel,
      next: { principal, level },
      knowledgeBaseId: props.knowledgeBaseId,
    });
    if (!plan.ok) {
      dispatch({
        type: 'failed',
        reason: {
          key:
            plan.reason === 'beyond-grantor'
              ? 'youCannotGrantMoreAccessThanYouHave'
              : 'invalidOrDuplicatePrincipal',
        },
      });
      return;
    }
    dispatch({ type: 'grant', grant: { principal, level } });
    dispatch({ type: 'busy' });
    void run(async () => {
      await props.api.saveGrants(props.pageId, plan.grants);
      dispatch({ type: 'saved', grants: plan.grants, inherits: state.inherits });
      props.onSaved();
    });
  };

  return (
    <section
      aria-label={knowledgeT('pagePermissionsAndSharing')}
      className="flex flex-col gap-4 p-4"
    >
      {!writable && (
        <p className="rounded-md bg-overlay px-3 py-2 text-xs text-muted">
          {knowledgeT('pageEditPermissionOrHigherIsRequiredTo')}
        </p>
      )}

      <div>
        <h3 className="text-sm font-medium text-ink">{knowledgeT('effectiveAccess')}</h3>
        <p className="mt-1 text-xs text-muted">{explainSourceCopy(locale)[effective.source]}</p>
        <ul className="mt-2 flex flex-wrap gap-1">
          {effective.grants.map((grant) => (
            <li key={grant.principal} className="rounded bg-overlay px-2 py-1 text-xs text-ink">
              {principalKind(grant.principal) === 'knowledgeBase'
                ? knowledgeT('allMembers')
                : grant.principal}{' '}
              · {permissionLevelLabel(grant.level, locale)}
            </li>
          ))}
          {!effective.grants.length && <li className="text-xs text-muted">{knowledgeT('none')}</li>}
        </ul>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={state.inherits}
          disabled={!writable || state.busy}
          onChange={(event) => {
            dispatch({ type: 'inherit', value: event.target.checked });
            void run(async () => {
              await props.api.setInheritance(props.pageId, event.target.checked);
              dispatch({ type: 'saved', grants: state.grants, inherits: event.target.checked });
              props.onSaved();
            });
          }}
        />
        {knowledgeT('inheritParentPermissions')}
        {!state.inherits && (
          <span className="text-xs text-warn-ink">
            {knowledgeT('disabledReEnablingRecalculatesDescendantPermissions')}
          </span>
        )}
      </label>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-ink">{knowledgeT('explicitPermissions')}</h3>
        {state.grants.map((grant) => (
          <div
            key={grant.principal}
            className="flex items-center justify-between rounded-md bg-overlay px-3 py-2"
          >
            <span className="text-sm text-ink">{grant.principal}</span>
            <span className="flex items-center gap-2">
              <select
                value={grant.level}
                disabled={
                  !writable ||
                  state.busy ||
                  !canGrant(props.actorLevel, grant, props.knowledgeBaseId)
                }
                onChange={(event) => {
                  const next = {
                    principal: grant.principal,
                    level: event.target.value as PermissionLevel,
                  };
                  const plan = planGrantChange({
                    current: state.grants,
                    actorLevel: props.actorLevel,
                    next,
                    knowledgeBaseId: props.knowledgeBaseId,
                  });
                  if (!plan.ok) return;
                  void run(async () => {
                    await props.api.saveGrants(props.pageId, plan.grants);
                    dispatch({ type: 'saved', grants: plan.grants, inherits: state.inherits });
                    props.onSaved();
                  });
                }}
                className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
              >
                {permissionLevels.map((option) => (
                  <option key={option} value={option}>
                    {permissionLevelLabel(option, locale)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!writable || state.busy || !canRevoke(props.actorLevel, grant)}
                onClick={() => {
                  const next = state.grants.filter((entry) => entry.principal !== grant.principal);
                  void run(async () => {
                    await props.api.saveGrants(props.pageId, next);
                    dispatch({ type: 'saved', grants: next, inherits: state.inherits });
                    props.onSaved();
                  });
                }}
                className="rounded px-2 py-1 text-xs text-err-ink disabled:opacity-40"
              >
                {knowledgeT('remove')}
              </button>
            </span>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            value={principal}
            onChange={(event) => setPrincipal(event.target.value)}
            placeholder="user:… / group:… / knowledgeBase:…"
            disabled={!writable || state.busy}
            className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value as PermissionLevel)}
            disabled={!writable || state.busy}
            className="rounded-md border border-line bg-surface px-2 py-2 text-sm text-ink"
          >
            {permissionLevels
              .filter(
                (option) => !props.actorLevel || levelRank(option) <= levelRank(props.actorLevel),
              )
              .map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={addGrant}
            disabled={!writable || state.busy}
            className="rounded-md bg-accent px-3 py-2 text-sm text-accent-ink disabled:opacity-40"
          >
            {knowledgeT('add')}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-ink">{knowledgeT('shareLinks')}</h3>
        {props.links
          .filter((link) => !link.revoked)
          .map((link) => (
            <div
              key={link.linkId}
              className="flex items-center justify-between rounded-md bg-overlay px-3 py-2"
            >
              <span className="text-xs text-muted">
                {permissionLevelLabel(link.level, locale)}
                {link.expiresAt
                  ? knowledgeT('untilValue', { v0: formatDate(link.expiresAt, undefined, locale) })
                  : knowledgeT('noExpiry')}
              </span>
              <button
                type="button"
                disabled={!writable || state.busy}
                onClick={() =>
                  void run(async () => {
                    await props.api.revokeLink(link.linkId);
                    props.onSaved();
                  })
                }
                className="rounded px-2 py-1 text-xs text-err-ink disabled:opacity-40"
              >
                {knowledgeT('revoke')}
              </button>
            </div>
          ))}
        <div className="flex gap-2">
          <select
            value={linkLevel}
            onChange={(event) => setLinkLevel(event.target.value as PermissionLevel)}
            disabled={!writable || state.busy}
            className="rounded-md border border-line bg-surface px-2 py-2 text-sm text-ink"
          >
            {(['view', 'comment'] as const).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!writable || state.busy}
            onClick={() =>
              void run(async () => {
                const created = await props.api.createLink(props.pageId, linkLevel, null);
                dispatch({ type: 'token', linkId: created.linkId, token: created.token });
                props.onSaved();
              })
            }
            className="rounded-md bg-accent px-3 py-2 text-sm text-accent-ink disabled:opacity-40"
          >
            {knowledgeT('createLink')}
          </button>
        </div>
        {state.freshToken && (
          <p className="rounded-md bg-overlay px-3 py-2 text-xs text-ink">
            {knowledgeT('newLinkTokenShownOnlyOnce')}
            <code className="select-all text-accent-ink">{state.freshToken.token}</code>
          </p>
        )}
      </div>

      {state.error ? (
        <AppAlert
          tone="error"
          title={
            typeof state.error === 'string'
              ? state.error
              : knowledgeT(state.error.key, state.error.values)
          }
        />
      ) : null}
      {state.busy && (
        <p className="text-xs text-muted" aria-busy="true">
          {knowledgeT('saving')}
        </p>
      )}
    </section>
  );
}
