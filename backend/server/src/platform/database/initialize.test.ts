import { describe, expect, test } from 'bun:test';
import { FobDatabaseError, fobDatabaseErrorMessage, readFobDatabaseConnections } from './initialize-config';
import { isFobApplicationRoleSafe } from './initialize-role';
import type { FobApplicationRole } from './initialize-role';

describe('Fob database deployment configuration', () => {
  test('invalid or mismatched URLs fail without returning credential values', async () => {
    const secret = 'never-echo-this-secret';
    for (const values of [
      { DATABASE_ADMIN_URL: `http://admin:${secret}@localhost/knowledge`, DATABASE_URL: `postgres://app:${secret}@localhost/knowledge` },
      { DATABASE_ADMIN_URL: `postgres://admin:${secret}@localhost/one`, DATABASE_URL: `postgres://app:${secret}@localhost/two` },
      { DATABASE_ADMIN_URL: `postgres://admin:${secret}@host-a/knowledge`, DATABASE_URL: `postgres://app:${secret}@host-b/knowledge` },
    ]) {
      let message = '';
      try { await readFobDatabaseConnections(values); } catch (error) { message = fobDatabaseErrorMessage(error); }
      expect(message).toContain('same PostgreSQL database');
      expect(message).not.toContain(secret);
    }
    expect(fobDatabaseErrorMessage(Object.assign(new Error(secret), { code: '28P01' }))).toBe('Fob database command failed (PostgreSQL 28P01).');
    expect(fobDatabaseErrorMessage(new Error(`postgres://${secret}@localhost`))).not.toContain(secret);
    expect(fobDatabaseErrorMessage(new FobDatabaseError('already_initialized', 'Already initialized.'))).toBe('Already initialized.');
  });

  test('application role validation rejects every route to administrative privileges', () => {
    const safe: FobApplicationRole = {
      name: 'app', database: 'knowledge', address: '127.0.0.1', port: 5432,
      rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false,
      rolreplication: false, ownsDatabase: false, privilegedMembership: false,
    };
    expect(isFobApplicationRoleSafe(safe)).toBe(true);
    for (const flag of ['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'ownsDatabase', 'privilegedMembership'] as const) {
      expect(isFobApplicationRoleSafe({ ...safe, [flag]: true }), flag).toBe(false);
    }
  });
});
