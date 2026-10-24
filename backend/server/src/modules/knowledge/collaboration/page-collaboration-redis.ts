import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { Redis } from '@hocuspocus/extension-redis';
import type { RedisOptions } from 'ioredis';

/** Multi-node broadcast settings; omitting them keeps the host single-node. */
export interface PageCollaborationBroadcast {
  /** redis:// or rediss:// URL; the password rides in the URL and is never logged. */
  redisUrl: string;
  /** Pub/sub channel namespace shared by every node of one deployment. */
  prefix?: string;
}

const defaultPrefix = 'fob';

function assertRedisUrl(value: string): URL {
  const url = new URL(value);
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Page collaboration broadcast requires a redis:// or rediss:// URL.');
  return url;
}

/**
 * Environment first; local development falls back to the generated credentials
 * file, mirroring readFobDatabaseConnections. Never logs these values.
 */
export async function readPageCollaborationBroadcastConfig(environment: NodeJS.ProcessEnv = process.env): Promise<PageCollaborationBroadcast> {
  let local: Record<string, string | undefined> = {};
  if (!environment.REDIS_URL) {
    try {
      local = parseEnv(await readFile(new URL('../../../../../../.env.fob.local', import.meta.url), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const url = ({ ...local, ...environment }).REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not configured.');
  return { redisUrl: assertRedisUrl(url).toString() };
}

/**
 * The official multi-node transport: @hocuspocus/extension-redis. Each node
 * publishes Yjs sync messages on `{prefix}:{documentName}` and answers the
 * other nodes' state vectors on per-instance reply channels, so updates fan
 * out without a second body store: redis-origin transactions skip the store
 * hooks entirely, and a Redlock serializes the rare simultaneous store so
 * doc_state keeps a single writer (the B02 path).
 */
export function pageCollaborationRedisExtension(broadcast: PageCollaborationBroadcast): Redis {
  const url = assertRedisUrl(broadcast.redisUrl);
  const options: RedisOptions = {};
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  const db = Number(url.pathname.slice(1));
  if (url.pathname.length > 1 && Number.isInteger(db)) options.db = db;
  if (url.protocol === 'rediss:') options.tls = {};
  return new Redis({ port: Number(url.port) || 6379, host: url.hostname, options, prefix: broadcast.prefix ?? defaultPrefix });
}
