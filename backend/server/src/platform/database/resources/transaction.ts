import { entityIdSchema } from '@fob/shared/resources';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { resourceSchema } from './schema';

/** The request owns its transaction; services cannot start a second top-level one. */
export type ResourceTransaction = Omit<NodePgDatabase<typeof resourceSchema>, 'transaction'>;
export type FobIdentityTransaction = Pick<ResourceTransaction, 'select' | 'execute'>;
export type ResourceReadTransaction = Pick<ResourceTransaction, 'select'>;

/** Read one explicit reference resource without granting writes or losing the source scope.
 * Call serially within the owning transaction. Page ACL remains the caller's responsibility.
 */
export async function readKnowledgeBaseResource<T>(db: ResourceTransaction, knowledgeBaseId: string, operation: (db: ResourceReadTransaction) => Promise<T>): Promise<T> {
  if (!entityIdSchema.safeParse(knowledgeBaseId).success) throw new TypeError('Invalid reference knowledge base ID');
  const previous = await db.execute<{ value: string | null }>(sql`SELECT current_setting('app.read_knowledge_base_id', true) AS value`);
  await db.execute(sql`SELECT set_config('app.read_knowledge_base_id', ${knowledgeBaseId}, true)`);
  const restore = () => db.execute(sql`SELECT set_config('app.read_knowledge_base_id', ${previous.rows[0]?.value ?? ''}, true)`);
  let result: T;
  try { result = await operation(db); }
  catch (error) {
    // A failed SQL statement may already have aborted the transaction. Preserve
    // its error; the owner rolls back and clears every transaction-local scope.
    try { await restore(); } catch { /* transaction owner handles rollback */ }
    throw error;
  }
  await restore();
  return result;
}

export class ResourceTransactionAbortedError extends Error {
  constructor() {
    super('Resource transaction was rolled back instead of committed');
    this.name = 'ResourceTransactionAbortedError';
  }
}

/**
 * knowledgeBaseId must come from an authenticated, authorized server context.
 * This is the resource storage boundary, not a replacement for membership/ACL checks.
 * Never execute request work through pool.query inside this callback.
 */
export async function withKnowledgeBase<T>(
  pool: Pool,
  knowledgeBaseId: string,
  operation: (db: ResourceTransaction) => Promise<T>,
): Promise<T> {
  if (!entityIdSchema.safeParse(knowledgeBaseId).success) throw new TypeError('Invalid knowledge base ID');
  return withResourceScope(pool, { knowledgeBaseId, sessionId: '', readOnly: false }, operation);
}

/** sessionId must be obtained from a verified server-side auth session, never a request body. */
export async function withFobIdentity<T>(
  pool: Pool,
  sessionId: string,
  operation: (db: FobIdentityTransaction) => Promise<T>,
): Promise<T> {
  if (!entityIdSchema.safeParse(sessionId).success) throw new TypeError('Invalid session ID');
  return withResourceScope(pool, { knowledgeBaseId: '', sessionId, readOnly: true }, operation);
}

async function withResourceScope<T>(
  pool: Pool,
  scope: { knowledgeBaseId: string; sessionId: string; readOnly: boolean },
  operation: (db: ResourceTransaction) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let began = false;
  let reusable = false;
  let connectionError: Error | undefined;
  const onError = (error: Error) => { connectionError = error; };
  client.on('error', onError);

  try {
    await client.query(scope.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    began = true;
    // Explicitly clear the other scope even on a reused connection.
    await client.query("SELECT set_config('app.knowledge_base_id', $1, true), set_config('app.auth_session_id', $2, true), set_config('app.read_knowledge_base_id', '', true)", [scope.knowledgeBaseId, scope.sessionId]);
    const db: ResourceTransaction = drizzle(client, { schema: resourceSchema });
    const result = await operation(db);
    if (connectionError) throw connectionError;

    const completion = await client.query('COMMIT');
    began = false;
    // PostgreSQL returns ROLLBACK for COMMIT in an aborted transaction. A caller
    // catching a SQL error must not make an uncommitted write appear successful.
    reusable = !connectionError && ['COMMIT', 'ROLLBACK'].includes(completion.command);
    if (completion.command !== 'COMMIT') throw new ResourceTransactionAbortedError();
    return result;
  } catch (error) {
    if (began) {
      try {
        const rollback = await client.query('ROLLBACK');
        reusable = !connectionError && rollback.command === 'ROLLBACK';
      } catch {
        reusable = false;
      }
    }
    throw error;
  } finally {
    client.removeListener('error', onError);
    // Failed BEGIN, failed rollback and broken sockets never return to the pool.
    client.release(!reusable);
  }
}
