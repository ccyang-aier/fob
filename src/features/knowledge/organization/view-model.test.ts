import { describe, expect, test } from 'bun:test';
import {
  assignableRoles,
  canBrowseDirectory,
  canManageMember,
  canManageOrganization,
  defaultAccessLabel,
  defaultAccessOptions,
  deriveListState,
  needsAccessRebuildConfirmation,
} from './view-model';

/** The four observable list states plus the two data states they lead to. */
describe('deriveListState', () => {
  test('pending loads render the loading state regardless of stale data', () => {
    expect(deriveListState({ status: 'pending', itemCount: 5 })).toBe('loading');
  });

  test('auth and permission failures are distinct from other errors', () => {
    expect(deriveListState({ status: 'error', errorCode: 'UNAUTHENTICATED' })).toBe(
      'unauthenticated',
    );
    expect(deriveListState({ status: 'error', errorCode: 'FORBIDDEN' })).toBe('forbidden');
    expect(deriveListState({ status: 'error', errorCode: 'KNOWLEDGE_BASE_NOT_FOUND' })).toBe(
      'error',
    );
    expect(deriveListState({ status: 'error', errorCode: 'NETWORK' })).toBe('error');
    expect(deriveListState({ status: 'error', errorCode: null })).toBe('error');
  });

  test('success splits into empty and ready by item count', () => {
    expect(deriveListState({ status: 'success', itemCount: 0 })).toBe('empty');
    expect(deriveListState({ status: 'success', itemCount: 1 })).toBe('ready');
    expect(deriveListState({ status: 'success', itemCount: 12 })).toBe('ready');
    // A missing count can only be empty data, never a ready list.
    expect(deriveListState({ status: 'success' })).toBe('empty');
  });
});

/** Role rendering rules mirror the backend requireManager / requireRoleAuthority matrix. */
describe('role authority rendering', () => {
  test('guests cannot browse the directory; everyone else can', () => {
    expect(canBrowseDirectory('guest')).toBe(false);
    expect(canBrowseDirectory('member')).toBe(true);
    expect(canBrowseDirectory('admin')).toBe(true);
    expect(canBrowseDirectory('owner')).toBe(true);
  });

  test('only owners and admins see management controls', () => {
    expect(canManageOrganization('owner')).toBe(true);
    expect(canManageOrganization('admin')).toBe(true);
    expect(canManageOrganization('member')).toBe(false);
    expect(canManageOrganization('guest')).toBe(false);
  });

  test('assignable roles follow the authority matrix', () => {
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'member', 'guest']);
    expect(assignableRoles('admin')).toEqual(['member', 'guest']);
    expect(assignableRoles('member')).toEqual([]);
    expect(assignableRoles('guest')).toEqual([]);
  });

  test('per-row management is gated by the target role too', () => {
    expect(canManageMember('owner', 'owner')).toBe(true);
    expect(canManageMember('owner', 'guest')).toBe(true);
    expect(canManageMember('admin', 'admin')).toBe(false);
    expect(canManageMember('admin', 'owner')).toBe(false);
    expect(canManageMember('admin', 'member')).toBe(true);
    expect(canManageMember('admin', 'guest')).toBe(true);
    expect(canManageMember('member', 'guest')).toBe(false);
    expect(canManageMember('guest', 'member')).toBe(false);
  });
});

describe('root default access presentation', () => {
  test('exactly the four levels plus null, each labeled and described', () => {
    expect(defaultAccessOptions().map((option) => option.value)).toEqual([
      null,
      'view',
      'comment',
      'edit',
      'full',
    ]);
    for (const option of defaultAccessOptions()) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  test('labels resolve for every value with a safe fallback', () => {
    expect(defaultAccessLabel(null)).toBe('仅显式授权');
    expect(defaultAccessLabel('view')).toBe('可查看');
    expect(defaultAccessLabel('full')).toBe('完全控制');
    expect(defaultAccessLabel('unknown' as never)).toBe('仅显式授权');
  });

  test('only an actual change on an existing teamspace needs the rebuild confirmation', () => {
    expect(needsAccessRebuildConfirmation('view', 'view')).toBe(false);
    expect(needsAccessRebuildConfirmation('view', 'edit')).toBe(true);
    expect(needsAccessRebuildConfirmation(null, 'view')).toBe(true);
    expect(needsAccessRebuildConfirmation('full', null)).toBe(true);
  });
});
