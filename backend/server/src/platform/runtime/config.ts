import { readFobAuthConfig } from '../identity/config';
import { z } from 'zod';

export const runtimeRoles = ['api', 'collab', 'worker', 'mcp'] as const;
export type RuntimeRole = typeof runtimeRoles[number];

/**
 * One role, `all`, or a comma-separated subset — a single dev process hosts
 * `api,collab,mcp` while production scales each role independently. `all`
 * cannot be combined, duplicates collapse, unknown names are rejected.
 */
const roleSchema = z.string().optional().transform((value, context) => {
  const tokens = (value ?? 'all').split(',').map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0 || (tokens.includes('all') && tokens.length > 1)) {
    context.addIssue({ code: 'custom', message: 'ROLE must be one role, a comma-separated role list, or "all"' });
    return z.NEVER;
  }
  if (tokens[0] === 'all') return [...runtimeRoles];
  const roles: RuntimeRole[] = [];
  for (const token of tokens) {
    if (!(runtimeRoles as readonly string[]).includes(token)) {
      context.addIssue({ code: 'custom', message: `Unknown role "${token}"; expected one of: ${runtimeRoles.join(', ')}, all` });
      return z.NEVER;
    }
    if (!roles.includes(token as RuntimeRole)) roles.push(token as RuntimeRole);
  }
  return roles;
});

const urlFor = (protocols: readonly string[]) => z.url().refine((value) => {
  try { return protocols.includes(new URL(value).protocol); } catch { return false; }
});
const httpUrl = urlFor(['http:', 'https:']);
const databaseUrl = urlFor(['postgres:', 'postgresql:']);
const redisUrl = urlFor(['redis:', 'rediss:']);
const baseEnvironmentSchema = z.object({
  ROLE: roleSchema,
  DATABASE_URL: databaseUrl,
  FOB_SERVICE_HOST: z.string().min(1).default('127.0.0.1'),
  FOB_SERVICE_PORT: z.coerce.number().int().min(1).max(65535).default(8721),
  BETTER_AUTH_URL: httpUrl,
  BETTER_AUTH_SECRET: z.string().min(32),
  REDIS_URL: redisUrl.optional(),
  S3_ENDPOINT: httpUrl.optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(3).max(63).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  MEDIA_WORKER_URL: httpUrl.optional(),
  MEDIA_WORKER_TOKEN: z.string().min(32).max(256).regex(/^\S+$/).optional(),
  // Model credentials (the gitignored .env.knowledge.models.local); without
  // them the gateway keeps only explicit/Ollama bindings and AI tasks stay
  // unbound — a loud SERVICE_UNAVAILABLE, never a silent wrong provider.
  KNOWLEDGE_AI_API_KEY: z.string().min(1).optional(),
  KNOWLEDGE_AI_CHAT_BASE_URL: httpUrl.optional(),
  KNOWLEDGE_AI_MODEL: z.string().min(1).optional(),
  KNOWLEDGE_AI_VISION_MODEL: z.string().min(1).optional(),
  KNOWLEDGE_AI_EMBED_MODEL: z.string().min(1).optional(),
  KNOWLEDGE_AI_EMBED_DIMENSIONS: z.coerce.number().int().min(1).max(65535).optional(),
  KNOWLEDGE_AI_OLLAMA_ENDPOINT: httpUrl.optional(),
}).superRefine((environment, context) => {
  const active: readonly RuntimeRole[] = environment.ROLE;
  const require = (fields: (keyof typeof environment)[]) => {
    for (const field of fields) if (!environment[field]) context.addIssue({ code: 'custom', path: [field], message: 'Required for the selected role' });
  };
  if (active.includes('collab') || active.includes('worker')) require(['REDIS_URL']);
  if (environment.S3_ENDPOINT || active.some((role) => role === 'api' || role === 'worker')) require(['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
  if (active.includes('worker')) require(['MEDIA_WORKER_URL', 'MEDIA_WORKER_TOKEN']);

});

export function readFobServiceConfig(environment: Record<string, string | undefined> = process.env) {
  const optionalFields = new Set([
    'REDIS_URL', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
    'MEDIA_WORKER_URL', 'MEDIA_WORKER_TOKEN', 'KNOWLEDGE_AI_API_KEY', 'KNOWLEDGE_AI_CHAT_BASE_URL',
    'KNOWLEDGE_AI_MODEL', 'KNOWLEDGE_AI_VISION_MODEL', 'KNOWLEDGE_AI_EMBED_MODEL',
    'KNOWLEDGE_AI_EMBED_DIMENSIONS', 'KNOWLEDGE_AI_OLLAMA_ENDPOINT',
  ]);
  const values = Object.fromEntries(Object.entries(environment).map(([key, value]) =>
    [key, optionalFields.has(key) && value === '' ? undefined : value]));
  const parsed = baseEnvironmentSchema.safeParse(values);
  if (!parsed.success) {
    // Do not interpolate Zod values or URLs: these fields contain credentials.
    throw new Error(`Invalid Fob service configuration: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`);
  }
  const config = parsed.data;
  return Object.freeze({
    roles: config.ROLE,
    databaseUrl: config.DATABASE_URL,
    hostname: config.FOB_SERVICE_HOST,
    port: config.FOB_SERVICE_PORT,
    auth: readFobAuthConfig(environment),
    redisUrl: config.REDIS_URL,
    storage: config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT, region: config.S3_REGION!, bucket: config.S3_BUCKET!, accessKeyId: config.S3_ACCESS_KEY_ID!, secretAccessKey: config.S3_SECRET_ACCESS_KEY! } : undefined,
    mediaWorkerUrl: config.MEDIA_WORKER_URL,
    mediaWorkerToken: config.MEDIA_WORKER_TOKEN,
    models: Object.freeze({
      apiKey: config.KNOWLEDGE_AI_API_KEY,
      chatBaseUrl: config.KNOWLEDGE_AI_CHAT_BASE_URL,
      model: config.KNOWLEDGE_AI_MODEL,
      visionModel: config.KNOWLEDGE_AI_VISION_MODEL,
      embedModel: config.KNOWLEDGE_AI_EMBED_MODEL,
      embedDimensions: config.KNOWLEDGE_AI_EMBED_DIMENSIONS,
      ollamaEndpoint: config.KNOWLEDGE_AI_OLLAMA_ENDPOINT,
    }),
  });
}

export type FobServiceConfig = ReturnType<typeof readFobServiceConfig>;
