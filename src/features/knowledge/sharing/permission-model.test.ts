import { describe, expect, test } from 'bun:test';
import {
  canGrant,
  canRevoke,
  explainEffective,
  explainSourceCopy,
  levelRank,
  planGrantChange,
  principalKind,
  shareLinkMaxLevel,
} from './permission-model';

describe('permission model', () => {
  test('level ordering and principal parsing', () => {
    expect(levelRank('view')).toBeLessThan(levelRank('comment'));
    expect(levelRank('comment')).toBeLessThan(levelRank('edit'));
    expect(levelRank('edit')).toBeLessThan(levelRank('full'));
    expect(principalKind('user:u1')).toBe('user');
    expect(principalKind('group:g1')).toBe('group');
    expect(principalKind('knowledgeBase:w1')).toBe('knowledgeBase');
    expect(principalKind('link:l1')).toBe('link');
    expect(principalKind('bogus')).toBe('unknown');
    expect(shareLinkMaxLevel).toBe('comment');
  });

  test('grants cannot exceed the actor level and knowledgeBase principals must match', () => {
    expect(canGrant('edit', { principal: 'user:u1', level: 'edit' }, 'w1')).toBe(true);
    expect(canGrant('edit', { principal: 'user:u1', level: 'full' }, 'w1')).toBe(false);
    expect(canGrant(null, { principal: 'user:u1', level: 'view' }, 'w1')).toBe(false);
    expect(canGrant('full', { principal: 'knowledgeBase:w1', level: 'view' }, 'w1')).toBe(true);
    expect(canGrant('full', { principal: 'knowledgeBase:w2', level: 'view' }, 'w1')).toBe(false);
    expect(canGrant('full', { principal: 'bogus', level: 'view' }, 'w1')).toBe(false);
    expect(canRevoke('edit', { principal: 'user:u1', level: 'full' })).toBe(false);
    expect(canRevoke('full', { principal: 'user:u1', level: 'edit' })).toBe(true);
  });

  test('effective permission explanation prefers explicit, then break, then root default, then inheritance', () => {
    const explicit = [{ principal: 'user:u1', level: 'view' as const }];
    expect(
      explainEffective({
        explicit,
        inheritsPermissions: true,
        rootDefault: 'edit',
        inheritedGrants: [],
      }).source,
    ).toBe('explicit');
    expect(
      explainEffective({
        explicit: [],
        inheritsPermissions: false,
        rootDefault: 'edit',
        inheritedGrants: explicit,
      }).source,
    ).toBe('none');
    expect(
      explainEffective({
        explicit: [],
        inheritsPermissions: true,
        rootDefault: 'comment',
        inheritedGrants: explicit,
      }).source,
    ).toBe('root-default');
    expect(
      explainEffective({
        explicit: [],
        inheritsPermissions: true,
        rootDefault: null,
        inheritedGrants: explicit,
      }).source,
    ).toBe('inherited');
    expect(Object.keys(explainSourceCopy())).toEqual([
      'explicit',
      'root-default',
      'inherited',
      'none',
    ]);
  });

  test('grant planning deduplicates, overrides levels and rejects beyond-grantor changes', () => {
    const current = [{ principal: 'user:u1', level: 'view' as const }];
    const override = planGrantChange({
      current,
      actorLevel: 'edit',
      next: { principal: 'user:u1', level: 'edit' },
      knowledgeBaseId: 'w1',
    });
    expect(override.ok).toBe(true);
    if (override.ok) {
      expect(override.grants).toEqual([{ principal: 'user:u1', level: 'edit' }]);
    }
    expect(
      planGrantChange({
        current,
        actorLevel: 'view',
        next: { principal: 'user:u2', level: 'edit' },
        knowledgeBaseId: 'w1',
      }),
    ).toEqual({ ok: false, reason: 'beyond-grantor' });
    expect(
      planGrantChange({
        current: [],
        actorLevel: 'full',
        next: { principal: 'what', level: 'view' },
        knowledgeBaseId: 'w1',
      }),
    ).toEqual({ ok: false, reason: 'invalid-principal' });
  });
});
