/**
 * Idempotent seeding of the built-in local admin account. Re-running resets
 * the password, so credentials printed here are always current. The account
 * bypasses no policy: it is an ordinary credential user with emailVerified
 * set, exactly as the verification flow would leave it.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import { Pool } from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(resolve(root, '.env.fob.local'), 'utf8');
  const match = /^DATABASE_URL=(.+)$/m.exec(env);
  if (!match) throw new Error('DATABASE_URL not found in process env or .env.fob.local');
  return match[1].trim().replace(/^["']|["']$/g, '');
}

const email = (process.env.FOB_ADMIN_EMAIL ?? 'admin@fob.local').toLowerCase();
const password = process.env.FOB_ADMIN_PASSWORD ?? 'FobAdmin-2026-mK7qXz';
const name = process.env.FOB_ADMIN_NAME ?? 'Fob Admin';

async function main() {
  if (password.length < 12) throw new Error('Admin password must be at least 12 characters.');
  const pool = new Pool({ connectionString: databaseUrl(), max: 1 });
  pool.on('error', () => {});
  try {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO auth.user (id, name, email, email_verified)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, email_verified = true, updated_at = clock_timestamp()
       RETURNING id`,
      [randomUUID(), name, email],
    );
    await pool.query(
      `INSERT INTO auth.account (id, user_id, account_id, provider_id, password)
       VALUES ($1::uuid, $2::uuid, $2::text, 'credential', $3)
       ON CONFLICT (provider_id, account_id) DO UPDATE SET password = EXCLUDED.password, updated_at = clock_timestamp()`,
      [randomUUID(), user.rows[0].id, await hashPassword(password)],
    );
    console.log(`development account ready: ${email} (${name})`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
