import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { getOAuthState } from 'better-auth/api';
import { z } from 'zod';

export const oauthFlowSchema = z.strictObject({
  providerId: z.string(), mode: z.enum(['sign-in', 'link']), sessionId: z.string().nullable(), userId: z.string().nullable(),
});
const markerPrefix = 'fob:oauth:consumed:v1:';

/** Called only after Better Auth has verified its signed cookie and parsed the stored state. */
export async function claimOAuthState(pool: Pool, providerId: string): Promise<void> {
  const state = await getOAuthState();
  const flow = oauthFlowSchema.safeParse(state?.serverContext?.fob);
  if (!flow.success || flow.data.providerId !== providerId || !state?.oauthState || state.expiresAt <= Date.now()) throw new Error('Invalid OAuth flow');
  await consumeOAuthStateMarker(pool, state.oauthState, state.expiresAt);
}

/** Single-use primitive, not an authentication check; the caller must first verify state/cookie. */
export async function consumeOAuthStateMarker(pool: Pool, state: string, stateExpiresAt: number): Promise<void> {
  const digest = createHash('sha256').update(markerPrefix).update(state).digest();
  const hex = digest.toString('hex');
  // Version 8 is a reserved application namespace, distinct from all randomUUID v4 rows.
  digest[6] = (digest[6]! & 15) | 128;
  digest[8] = (digest[8]! & 63) | 128;
  const id = digest.subarray(0, 16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  const expiresAt = new Date(Math.max(Date.now() + 15 * 60_000, stateExpiresAt + 60_000));
  // The pinned SDK removes its original state before getToken and offers no atomic
  // consume hook. This existing-table marker closes concurrent distinct-code replay.
  const result = await pool.query(`WITH cleanup AS (
      DELETE FROM auth.verification WHERE id IN (
        SELECT id FROM auth.verification WHERE identifier LIKE 'fob:oauth:consumed:v1:%'
        AND expires_at < clock_timestamp() ORDER BY expires_at LIMIT 128
      )
    ) INSERT INTO auth.verification (id, identifier, value, expires_at)
      VALUES ($1, $2, '{}', $3) ON CONFLICT (id) DO NOTHING RETURNING id`, [id, markerPrefix + hex, expiresAt]);
  if (result.rowCount !== 1) throw new Error('OAuth flow already consumed');
}
