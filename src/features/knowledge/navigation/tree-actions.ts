import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './tree-actions.messages';

/**
 * Tree action definitions, the permission gate and the failure copy (U03).
 *
 * The menu of every tree row is data, not JSX: `treeActionsFor` returns the
 * ordered action set of one row filtered by the write gate (guest or missing
 * write scope sees read-only rows) and by structural rules (the recycle bin
 * restores instead of editing). Keyboard intents map raw key events onto the
 * same actions, so the context menu and the keyboard can never diverge.
 *
 * `treeOperationErrorText` turns the U01 structured error codes into Chinese
 * copy that names the operation, the reason and the rollback — the §5.4
 * contract for a failed optimistic write.
 */

import type { KnowledgeAccess } from '../data/hooks';
import type { KnowledgeErrorCode } from '../data/errors';
import { isKnowledgeDataError } from '../data/errors';

const knowledgeT = createTranslator(knowledgeMessages);

export type TreeActionId =
  | 'create-child'
  | 'rename'
  | 'set-icon'
  | 'set-cover'
  | 'move-up'
  | 'move-down'
  | 'indent'
  | 'outdent'
  | 'recycle'
  | 'restore';

export type TreeAction = {
  id: TreeActionId;
  label: string;
  /** Danger actions render with the error ink (destructive intent). */
  danger?: boolean;
};

function rowActions(locale?: Locale): readonly TreeAction[] {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return [
    { id: 'create-child', label: knowledgeT('newSubpage') },
    { id: 'rename', label: knowledgeT('rename') },
    { id: 'set-icon', label: knowledgeT('changeIcon') },
    { id: 'set-cover', label: knowledgeT('setCover') },
    { id: 'move-up', label: knowledgeT('moveUp') },
    { id: 'move-down', label: knowledgeT('moveDown') },
    { id: 'indent', label: knowledgeT('indent') },
    { id: 'outdent', label: knowledgeT('outdent') },
    { id: 'recycle', label: knowledgeT('moveToTrash'), danger: true },
  ];
}

/** The full row action set; the caller disables entries the structure rejects. */
export function treeActionsForRow(): readonly TreeAction[] {
  return rowActions();
}

/** The write gate: a guest role or a scope without write is a read-only tree (U05 owns fine-grained page ACL UI). */
export function canEditTree(access: KnowledgeAccess | undefined): boolean {
  if (!access) return false;
  return access.role !== 'guest' && access.scopes.includes('write');
}

export function readOnlyTreeReason(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return knowledgeT('yourKnowledgeBaseRoleIsReadOnlyPage');
}

// ── Keyboard intents ────────────────────────────────────────────────────

export type OperationKeyIntent =
  | { kind: 'create-child' }
  | { kind: 'rename' }
  | { kind: 'recycle' }
  | { kind: 'move'; direction: 'up' | 'down' | 'indent' | 'outdent' };

export type KeyLike = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

/**
 * The operation keys of one focused row. Alt+Arrows move (the plain arrows
 * stay pure navigation of the U02 roving model), F2/Enter rename, Delete
 * recycles, Cmd/Ctrl+N creates a child page.
 */
export function operationKeyIntent(event: KeyLike): OperationKeyIntent | null {
  const mod = Boolean(event.metaKey || event.ctrlKey);
  switch (event.key) {
    case 'Enter':
    case 'F2':
      return { kind: 'rename' };
    case 'Delete':
      return { kind: 'recycle' };
    case 'n':
    case 'N':
      return mod ? { kind: 'create-child' } : null;
    case 'ArrowUp':
      return event.altKey ? { kind: 'move', direction: 'up' } : null;
    case 'ArrowDown':
      return event.altKey ? { kind: 'move', direction: 'down' } : null;
    case 'ArrowRight':
      return event.altKey ? { kind: 'move', direction: 'indent' } : null;
    case 'ArrowLeft':
      return event.altKey ? { kind: 'move', direction: 'outdent' } : null;
    default:
      return null;
  }
}

// ── Failure copy ────────────────────────────────────────────────────────

function actionLabels(locale?: Locale): Record<TreeActionId, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    'create-child': knowledgeT('newPage'),
    rename: knowledgeT('renamePage'),
    'set-icon': knowledgeT('changeIcon2'),
    'set-cover': knowledgeT('setCover2'),
    'move-up': knowledgeT('movePage'),
    'move-down': knowledgeT('movePage'),
    indent: knowledgeT('movePage'),
    outdent: knowledgeT('movePage'),
    recycle: knowledgeT('moveToTrash'),
    restore: knowledgeT('restorePage'),
  };
}

function errorCodeCopy(locale?: Locale): Record<KnowledgeErrorCode, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    UNAUTHENTICATED: knowledgeT('yourSessionHasExpiredSignInAgainAnd'),
    PAYMENT_REQUIRED: knowledgeT('yourPlanDoesNotSupportThisAction'),
    FORBIDDEN: knowledgeT('youDoNotHavePermissionForThisAction'),
    NOT_FOUND: knowledgeT('pageNotFoundOrRemovedRefreshTheDirectory'),
    INVALID_REQUEST: knowledgeT('invalidPageTreeRequest'),
    CONFLICT: knowledgeT('pageStructureChangedBySomeoneElseResynchronizing'),
    PAYLOAD_TOO_LARGE: knowledgeT('requestExceedsTheSizeLimit'),
    RATE_LIMITED: knowledgeT('tooManyActionsRetryLater'),
    TIMEOUT: knowledgeT('actionTimedOutPleaseRetry'),
    UNAVAILABLE: knowledgeT('knowledgeServiceUnavailable'),
    NETWORK: knowledgeT('unableToConnectToKnowledgeServiceCheckYour'),
    ENDPOINT: knowledgeT('knowledgeServiceAddressIsNotConfigured'),
  };
}

/** One structured Chinese line for a failed optimistic operation: what failed, why, and that the tree was restored. */
export function treeOperationErrorText(action: TreeActionId, error: unknown): string {
  const label = actionLabels()[action];
  if (isKnowledgeDataError(error)) {
    return knowledgeT('valueFailedValueValuePreviousPageTreeRestored', {
      v0: label,
      v1: error.code,
      v2: errorCodeCopy()[error.code],
    });
  }
  return knowledgeT('valueFailedConnectionErrorPreviousPageTreeRestored', { v0: label });
}

/** Success copy for the two operations whose outcome is worth confirming (recoverable deletion / restoration). */
export function treeOperationSuccessText(action: 'recycle' | 'restore', title: string): string {
  return action === 'recycle'
    ? knowledgeT('valueMovedToTrashYouCanRestoreIt', { v0: title })
    : knowledgeT('valueRestoredToItsOriginalLocation', { v0: title });
}
