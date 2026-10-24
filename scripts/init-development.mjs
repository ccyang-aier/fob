import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = path.join(root, '.env.fob.local');
const secret = () => randomBytes(32).toString('hex');
const existing = existsSync(config) ? parseEnv(readFileSync(config, 'utf8')) : {};
const adminSecret = existing.FOB_POSTGRES_PASSWORD ?? secret();
const appSecret = existing.FOB_DATABASE_APP_PASSWORD ?? secret();
const redisSecret = existing.KNOWLEDGE_REDIS_PASSWORD ?? secret();
const values = {
  KNOWLEDGE_WSL_DISTRO: 'Ubuntu-22.04',
  FOB_POSTGRES_USER: 'fob_admin', FOB_POSTGRES_DB: 'fob',
  FOB_POSTGRES_PASSWORD: adminSecret, FOB_DATABASE_APP_PASSWORD: appSecret,
  DATABASE_ADMIN_URL: `postgresql://fob_admin:${adminSecret}@127.0.0.1:55433/fob`,
  DATABASE_URL: `postgresql://fob_app:${appSecret}@127.0.0.1:55433/fob`,
  KNOWLEDGE_REDIS_PASSWORD: redisSecret,
  REDIS_URL: `redis://:${redisSecret}@127.0.0.1:56380`,
  S3_ENDPOINT: 'http://127.0.0.1:59010', S3_REGION: 'us-east-1', S3_BUCKET: 'fob-knowledge',
  S3_ACCESS_KEY_ID: `fob${randomBytes(10).toString('hex')}`, S3_SECRET_ACCESS_KEY: secret(),
  FOB_WEB_PORT: '3001', FOB_SERVICE_HOST: '127.0.0.1', FOB_SERVICE_PORT: '8721', FOB_DEV_WORKER: '1',
  NEXT_PUBLIC_FOB_API_URL: 'http://127.0.0.1:8721', ROLE: 'api,collab,mcp',
  BETTER_AUTH_URL: 'http://127.0.0.1:8721', BETTER_AUTH_SECRET: secret(),
  FOB_AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:8721,http://localhost:8721',
  FOB_AUTH_COOKIE_MODE: 'same-site',
  MEDIA_WORKER_URL: 'http://127.0.0.1:8920', MEDIA_WORKER_TOKEN: secret(),
  MEDIA_WORKER_DOWNLOAD_ORIGINS: 'http://127.0.0.1:59010',
  ...existing,
};
writeFileSync(config, '# Fob-only development configuration. Do not commit.\n' + Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
const nextConfig = path.join(root, '.env.local');
if (!existsSync(nextConfig)) writeFileSync(nextConfig, `NEXT_PUBLIC_FOB_API_URL=${values.NEXT_PUBLIC_FOB_API_URL}\n`, { flag: 'wx', mode: 0o600 });
console.log('Fob development configuration is ready; independent secrets were generated without reading another product.');
console.log('Next: pnpm infra:up; pnpm database:init; pnpm knowledge:jobs:init; pnpm dev:all');
