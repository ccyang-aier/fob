import { describe, expect, test } from 'bun:test';
import { KnowledgeDataError } from '../data/errors';
import type { KnowledgeAccess } from '../data/hooks';
import {
  canEditTree,
  operationKeyIntent,
  readOnlyTreeReason,
  treeActionsForRow,
  treeOperationErrorText,
  treeOperationSuccessText,
} from './tree-actions';

function access(
  role: 'owner' | 'admin' | 'member' | 'guest',
  scopes: readonly string[],
): KnowledgeAccess {
  return {
    knowledgeBaseId: 'e2f7a4c1-0000-4000-8000-6b1f9a2c3d01',
    userId: '90000000-0000-4000-8000-000000000000',
    role,
    actor: { kind: 'human', userId: '90000000-0000-4000-8000-000000000000' },
    credentialKind: 'session',
    scopes,
  } as KnowledgeAccess;
}

describe('canEditTree (write gate)', () => {
  test('needs a write scope; guests never edit even with a stray write scope', () => {
    expect(canEditTree(access('owner', ['read', 'write']))).toBe(true);
    expect(canEditTree(access('member', ['read', 'write']))).toBe(true);
    expect(canEditTree(access('guest', ['read', 'write']))).toBe(false);
    expect(canEditTree(access('admin', ['read']))).toBe(false);
    expect(canEditTree(undefined)).toBe(false);
  });

  test('the read-only reason names the permission requirement', () => {
    expect(readOnlyTreeReason()).toContain('只读');
    expect(readOnlyTreeReason()).toContain('编辑权限');
  });
});

describe('operationKeyIntent', () => {
  const key = (k: string, modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {}) => ({
    key: k,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
  });

  test('F2/Enter rename, Delete recycles, Cmd/Ctrl+N creates a child', () => {
    expect(operationKeyIntent(key('F2'))).toEqual({ kind: 'rename' });
    expect(operationKeyIntent(key('Enter'))).toEqual({ kind: 'rename' });
    expect(operationKeyIntent(key('Delete'))).toEqual({ kind: 'recycle' });
    expect(operationKeyIntent(key('n', { meta: true }))).toEqual({ kind: 'create-child' });
    expect(operationKeyIntent(key('N', { ctrl: true }))).toEqual({ kind: 'create-child' });
    expect(operationKeyIntent(key('n'))).toBeNull();
    expect(operationKeyIntent(key('n', { alt: true }))).toBeNull();
  });

  test('Alt+Arrows move; plain arrows stay navigation (null here)', () => {
    expect(operationKeyIntent(key('ArrowUp', { alt: true }))).toEqual({
      kind: 'move',
      direction: 'up',
    });
    expect(operationKeyIntent(key('ArrowDown', { alt: true }))).toEqual({
      kind: 'move',
      direction: 'down',
    });
    expect(operationKeyIntent(key('ArrowRight', { alt: true }))).toEqual({
      kind: 'move',
      direction: 'indent',
    });
    expect(operationKeyIntent(key('ArrowLeft', { alt: true }))).toEqual({
      kind: 'move',
      direction: 'outdent',
    });
    expect(operationKeyIntent(key('ArrowUp'))).toBeNull();
    expect(operationKeyIntent(key('ArrowRight'))).toBeNull();
  });

  test('the row action set covers the U03 operation collection, recycle marked destructive', () => {
    const ids = treeActionsForRow().map((action) => action.id);
    expect(ids).toEqual([
      'create-child',
      'rename',
      'set-icon',
      'set-cover',
      'move-up',
      'move-down',
      'indent',
      'outdent',
      'recycle',
    ]);
    expect(treeActionsForRow().find((action) => action.id === 'recycle')?.danger).toBe(true);
  });
});

describe('treeOperationErrorText / treeOperationSuccessText', () => {
  test('structured errors name the action, the code, the Chinese reason and the rollback', () => {
    const text = treeOperationErrorText('rename', new KnowledgeDataError('NOT_FOUND'));
    expect(text).toContain('重命名页面失败（NOT_FOUND）');
    expect(text).toContain('页面不存在或已被移除');
    expect(text).toContain('已恢复');

    const forbidden = treeOperationErrorText('move-down', new KnowledgeDataError('FORBIDDEN'));
    expect(forbidden).toContain('移动页面失败（FORBIDDEN）');
    expect(forbidden).toContain('没有执行该操作的权限');

    const network = treeOperationErrorText('recycle', new Error('offline'));
    expect(network).toContain('移入回收站失败');
    expect(network).toContain('已恢复');
  });

  test('recycle and restore success copy points at the recovery loop', () => {
    expect(treeOperationSuccessText('recycle', '路线图')).toContain('回收站');
    expect(treeOperationSuccessText('restore', '路线图')).toContain('恢复到原位置');
  });
});
