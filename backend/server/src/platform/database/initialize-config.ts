import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export class FobDatabaseError extends Error {
  constructor(readonly code: 'invalid_config' | 'unsafe_role' | 'database_mismatch' | 'already_initialized' | 'check_failed', message: string) {
    super(message);
    this.name = 'FobDatabaseError';
  }
}

export async function readFobDatabaseConnections(environment: NodeJS.ProcessEnv = process.env) {
  let local: Record<string, string | undefined> = {};
  if (!environment.DATABASE_ADMIN_URL || !environment.DATABASE_URL) {
    try {
      local = parseEnv(await readFile(new URL('../../../../../.env.fob.local', import.meta.url), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const values = { ...local, ...environment };
  try {
    const admin = new URL(values.DATABASE_ADMIN_URL ?? '');
    const application = new URL(values.DATABASE_URL ?? '');
    if (![admin, application].every((url) => ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname && url.pathname.length > 1)) throw new Error();
    if (admin.host !== application.host || admin.pathname !== application.pathname) throw new Error();
    return { admin: admin.toString(), application: application.toString() };
  } catch {
    throw new FobDatabaseError('invalid_config', 'DATABASE_ADMIN_URL and DATABASE_URL must target the same PostgreSQL database.');
  }
}

/** Database errors may include SQL parameters and credentials; never print them. */
export function fobDatabaseErrorMessage(error: unknown): string {
  if (error instanceof FobDatabaseError) return error.message;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return `Fob database command failed (PostgreSQL ${error.code}).`;
  }
  return 'Fob database command failed. Verify the connection settings, administrator privileges, and PostgreSQL service.';
}
