/**
 * Pure view-model tests of the editor (E03): the B04 status → indicator
 * mapping, the P03 level → readonly decision, the access gate mapping and
 * their combination into the closed-loop view model — no React, no DOM.
 */
import { describe, expect, test } from 'bun:test';
import type { PermissionLevel } from '@fob/shared/knowledge/contracts';
import type { PageDocumentStatus, PageDocumentPhase } from '../collaboration/page-sync-state';
import {
  derivePageEditorView,
  levelSatisfies,
  pageEditorGateOf,
  permissionLevelLabel,
  syncIndicatorView,
} from './editor-state';

const status = (phase: PageDocumentPhase, overrides: Partial<PageDocumentStatus> = {}): PageDocumentStatus => ({
  phase,
  localReady: true,
  cloudPending: false,
  ...overrides,
});

describe('levelSatisfies / permissionLevelLabel', () => {
  test('levels order view < comment < edit < full', () => {
    const levels: PermissionLevel[] = ['view', 'comment', 'edit', 'full'];
    for (const level of levels) {
      expect(levelSatisfies(level, 'view')).toBe(true);
      expect(levelSatisfies(level, 'edit')).toBe(level === 'edit' || level === 'full');
    }
    expect(levelSatisfies('view', 'full')).toBe(false);
    expect(levelSatisfies('comment', 'edit')).toBe(false);
    expect(levelSatisfies('full', 'full')).toBe(true);
  });

  test('labels exist for every level', () => {
    expect(permissionLevelLabel('view')).toBe('查看');
    expect(permissionLevelLabel('comment')).toBe('评论');
    expect(permissionLevelLabel('edit')).toBe('编辑');
    expect(permissionLevelLabel('full')).toBe('完全访问');
  });
});

describe('pageEditorGateOf', () => {
  test('pending stays pending regardless of stale data', () => {
    expect(pageEditorGateOf({ isPending: true, error: null, data: { authorized: true, level: 'edit' } })).toEqual({ status: 'pending' });
  });

  test('failures become the retryable error gate', () => {
    expect(pageEditorGateOf({ isPending: false, error: { code: 'NETWORK' }, data: null })).toEqual({ status: 'error' });
    // Defensive: a settled query without data or error cannot claim access either.
    expect(pageEditorGateOf({ isPending: false, error: null, data: null })).toEqual({ status: 'error' });
  });

  test('an allow answer carries the effective level; a denial is terminal', () => {
    expect(pageEditorGateOf({ isPending: false, error: null, data: { authorized: true, level: 'view' } })).toEqual({ status: 'granted', level: 'view' });
    expect(pageEditorGateOf({ isPending: false, error: null, data: { authorized: true, level: 'full' } })).toEqual({ status: 'granted', level: 'full' });
    expect(pageEditorGateOf({ isPending: false, error: null, data: { authorized: false, level: null } })).toEqual({ status: 'denied' });
    // A malformed allow without a level cannot silently grant edit rights.
    expect(pageEditorGateOf({ isPending: false, error: null, data: { authorized: true, level: null } })).toEqual({ status: 'denied' });
  });
});

describe('syncIndicatorView', () => {
  test('no session and un-loaded local copy stay busy loading states', () => {
    expect(syncIndicatorView(null)).toMatchObject({ badge: 'loading', busy: true, tone: 'quiet' });
    expect(syncIndicatorView(status('local-only', { localReady: false }))).toMatchObject({ badge: 'loading', busy: true });
    expect(syncIndicatorView(status('syncing', { localReady: false }))).toMatchObject({ badge: 'loading', busy: true });
  });

  test('every B04 phase maps to one honest indicator state', () => {
    expect(syncIndicatorView(status('local-only'))).toMatchObject({ badge: 'local-only', tone: 'quiet', busy: false });
    expect(syncIndicatorView(status('syncing'))).toMatchObject({ badge: 'syncing', tone: 'progress', busy: true });
    expect(syncIndicatorView(status('synced'))).toMatchObject({ badge: 'synced', tone: 'ok', busy: false });
    expect(syncIndicatorView(status('offline'))).toMatchObject({ badge: 'offline', tone: 'warn', busy: false });
    expect(syncIndicatorView(status('error', { errorReason: 'permission-denied' }))).toMatchObject({ badge: 'error', tone: 'error', busy: false });
  });

  test('the rejected state names the server reason', () => {
    const view = syncIndicatorView(status('error', { errorReason: 'permission-denied' }));
    expect(view.hint).toContain('permission-denied');
    expect(syncIndicatorView(status('error')).hint).not.toContain('（');
  });
});

describe('derivePageEditorView — the closed loop', () => {
  test('unpassed gates never open the editor', () => {
    for (const gate of [{ status: 'pending' }, { status: 'denied' }, { status: 'error' }] as const) {
      const view = derivePageEditorView(gate, status('synced'));
      expect(view.open).toBe(false);
      expect(view.editable).toBe(false);
      expect(view.readonlyReason).toBeNull();
    }
  });

  test('below-edit levels render read-only across every sync phase', () => {
    for (const level of ['view', 'comment'] as const) {
      for (const phase of ['local-only', 'syncing', 'synced', 'offline'] as const) {
        const view = derivePageEditorView({ status: 'granted', level }, status(phase));
        expect(view.open).toBe(true);
        expect(view.editable).toBe(false);
        expect(view.readonlyReason).toBe('below-edit');
      }
    }
  });

  test('edit levels keep editing through the offline lifecycle (§5.4)', () => {
    for (const level of ['edit', 'full'] as const) {
      for (const phase of ['local-only', 'syncing', 'synced', 'offline'] as const) {
        const view = derivePageEditorView({ status: 'granted', level }, status(phase));
        expect(view.editable).toBe(true);
        expect(view.readonlyReason).toBeNull();
      }
    }
  });

  test('a terminal auth failure stops editing even for full access', () => {
    const view = derivePageEditorView({ status: 'granted', level: 'full' }, status('error'));
    expect(view.open).toBe(true);
    expect(view.editable).toBe(false);
    expect(view.readonlyReason).toBe('auth-failed');
    expect(view.sync.badge).toBe('error');
  });
});
