import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { initializeFobDatabase } from '../src/platform/database/initialize';
import { FobDatabaseError, fobDatabaseErrorMessage, readFobDatabaseConnections } from '../src/platform/database/initialize-config';
import { inspectFobDatabase } from '../src/platform/database/initialize-status';

export async function runFobDatabaseCommand(command: string, environment: NodeJS.ProcessEnv = process.env) {
  if (!['init', 'status', 'check'].includes(command)) throw new FobDatabaseError('invalid_config', 'Usage: bun backend/server/scripts/database.ts [init|status|check]');
  const connections = await readFobDatabaseConnections(environment);
  const admin = new Pool({ connectionString: connections.admin, max: 1, connectionTimeoutMillis: 10_000 });
  const application = new Pool({ connectionString: connections.application, max: 1, connectionTimeoutMillis: 10_000 });
  // An idle socket error is handled by pg-pool; output stays credential-free.
  for (const pool of [admin, application]) pool.on('error', () => {});
  try {
    if (command === 'init') await initializeFobDatabase(admin, application);
    const status = await inspectFobDatabase(admin, application);
    if (command !== 'status' && status.state !== 'ready') {
      throw new FobDatabaseError('check_failed', `Fob database is ${status.state}: ${status.issues.join('; ') || 'run init on an empty database'}`);
    }
    return status;
  } finally {
    await Promise.all([admin.end(), application.end()]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFobDatabaseCommand(process.argv[2] ?? 'status').then((status) => {
    console.log(JSON.stringify(status, null, 2));
  }).catch((error: unknown) => {
    console.error(fobDatabaseErrorMessage(error));
    process.exitCode = 1;
  });
}
