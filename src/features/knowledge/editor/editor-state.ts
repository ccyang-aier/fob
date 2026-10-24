import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './editor-state.messages';

/**
 * Pure view-model logic of the page editor (E03, design §4/§5.1).
 *
 * Everything here is a pure function over the B04 session status and the P03
 * page access snapshot, so the full loading / offline / syncing / synced /
 * readonly / error closed loop is decidable — and testable — without React
 * or a browser. The container maps these results straight onto the UI; no
 * state is invented on the way.
 */

import { permissionLevels } from '@fob/shared/knowledge/contracts';
import type { PermissionLevel } from '@fob/shared/knowledge/contracts';
import type { PageDocumentStatus } from '../collaboration/page-sync-state';

const knowledgeT = createTranslator(knowledgeMessages);

/** Whether `level` grants at least `required` (view < comment < edit < full). */
export function levelSatisfies(level: PermissionLevel, required: PermissionLevel): boolean {
  return permissionLevels.indexOf(level) >= permissionLevels.indexOf(required);
}

export function permissionLevelLabel(level: PermissionLevel, locale?: Locale): string {
  const keys = { view: 'view', comment: 'comments', edit: 'edit', full: 'fullAccess' } as const;
  return createTranslator(knowledgeMessages, locale)(keys[level]);
}

export function readonlyMessageCopy(reason: ReadonlyReason, level: PermissionLevel): string {
  if (reason === 'auth-failed')
    return knowledgeT('knowledgeServiceRejectedSynchronizationTheLocalCopyIs');
  return level === 'comment'
    ? knowledgeT('readOnlyYourAccessLevelIsCommentYou')
    : knowledgeT('readOnlyYourAccessLevelIsValueYou', { v0: permissionLevelLabel(level) });
}

/** The P03 `page.access` gate in editor terms; `view` authorization answers with the effective level. */
export type PageEditorGate =
  | { status: 'pending' }
  | { status: 'granted'; level: PermissionLevel }
  | { status: 'denied' }
  | { status: 'error' };

export interface PageEditorGateQuery {
  isPending: boolean;
  error: unknown;
  data?: { authorized: boolean; level: PermissionLevel | null } | null;
}

/**
 * Maps one access query result onto the gate. The query asks for `view`
 * authorization; an allow response carries the page's effective level, so a
 * second round trip for editability is unnecessary, and a denial is terminal
 * for the whole editor (B01 would reject the collaboration connection too).
 */
export function pageEditorGateOf(query: PageEditorGateQuery): PageEditorGate {
  if (query.isPending) return { status: 'pending' };
  if (query.error !== null && query.error !== undefined) return { status: 'error' };
  const snapshot = query.data;
  // A settled query without a payload is a broken transport, not a denial.
  if (!snapshot) return { status: 'error' };
  if (!snapshot.authorized || !snapshot.level) return { status: 'denied' };
  return { status: 'granted', level: snapshot.level };
}

export type SyncBadge = 'loading' | 'local-only' | 'syncing' | 'synced' | 'offline' | 'error';
export type SyncTone = 'quiet' | 'progress' | 'ok' | 'warn' | 'error';

export interface SyncIndicatorView {
  badge: SyncBadge;
  /** Short product copy for the indicator pill. */
  label: string;
  /** One-sentence explanation of what the state means for the user's edits. */
  hint: string;
  tone: SyncTone;
  /** True while a result is expected momentarily (renders a spinner). */
  busy: boolean;
}

const loadingView = (label: string, hint: string): SyncIndicatorView => ({
  badge: 'loading',
  label,
  hint,
  tone: 'quiet',
  busy: true,
});

/** The B04 status machine (§5.1 lifecycle) as one honest indicator state. */
export function syncIndicatorView(status: PageDocumentStatus | null): SyncIndicatorView {
  if (!status)
    return loadingView(knowledgeT('openingDocument'), knowledgeT('establishingDocumentSession'));
  if (!status.localReady)
    return loadingView(
      knowledgeT('readingLocalCopy'),
      knowledgeT('restoringTheOfflineLocalCopyBeforeConnectingTo'),
    );
  switch (status.phase) {
    case 'local-only':
      return {
        badge: 'local-only',
        label: knowledgeT('savedLocally'),
        hint: knowledgeT('theLocalCopyIsReadyConnectingToKnowledge'),
        tone: 'quiet',
        busy: false,
      };
    case 'syncing':
      return {
        badge: 'syncing',
        label: knowledgeT('syncing'),
        hint: knowledgeT('exchangingDocumentUpdatesWithKnowledgeService'),
        tone: 'progress',
        busy: true,
      };
    case 'synced':
      return {
        badge: 'synced',
        label: knowledgeT('synced'),
        hint: knowledgeT('allChangesAreSyncedToKnowledgeService'),
        tone: 'ok',
        busy: false,
      };
    case 'offline':
      return {
        badge: 'offline',
        label: knowledgeT('offlineEditing'),
        hint: knowledgeT('disconnectedChangesAreSavedLocallyAndWillMerge'),
        tone: 'warn',
        busy: false,
      };
    case 'error':
      return {
        badge: 'error',
        label: knowledgeT('syncRejected'),
        hint: status.errorReason
          ? knowledgeT('knowledgeServiceRejectedSynchronizationForThisPageValue', {
              v0: status.errorReason,
            })
          : knowledgeT('knowledgeServiceRejectedSynchronizationForThisPageThe'),
        tone: 'error',
        busy: false,
      };
  }
}

/** Why the editor surface refuses edits right now. */
export type ReadonlyReason = 'below-edit' | 'auth-failed';

export interface PageEditorViewModel {
  /** Whether the editor surface may mount (the access gate has passed). */
  open: boolean;
  /** The gate, present for the container whenever `open` is false. */
  gate: PageEditorGate;
  /** The target `editable` of the Tiptap instance (`editor.setEditable`). */
  editable: boolean;
  readonlyReason: ReadonlyReason | null;
  sync: SyncIndicatorView;
}

/**
 * The single decision for the whole closed loop:
 *
 * - access below `edit` → always readonly with the access-level reason;
 * - a terminal B04 auth failure stops editing too (writes could never sync);
 * - every other phase — local-only, syncing, synced, offline — keeps the
 *   document editable (§5.4: offline body editing merges through the CRDT).
 */
export function derivePageEditorView(
  gate: PageEditorGate,
  status: PageDocumentStatus | null,
): PageEditorViewModel {
  if (gate.status !== 'granted') {
    return {
      open: false,
      gate,
      editable: false,
      readonlyReason: null,
      sync: syncIndicatorView(null),
    };
  }
  const canEditByAccess = levelSatisfies(gate.level, 'edit');
  const authFailed = status?.phase === 'error';
  return {
    open: true,
    gate,
    editable: canEditByAccess && !authFailed,
    readonlyReason: authFailed ? 'auth-failed' : canEditByAccess ? null : 'below-edit',
    sync: syncIndicatorView(status),
  };
}
