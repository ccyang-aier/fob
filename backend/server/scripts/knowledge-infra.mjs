import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const envPath = path.join(root, '.env.fob.local');
const project = 'fob-knowledge-dev';
const images = ['paradedb/paradedb:0.25.10-pg17', 'redis:7.4.8-alpine', 'golang:1.24.8-alpine', 'alpine:3.21'];
const windows = process.platform === 'win32';
const linuxPath = (value) => windows ? value.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/') : value;
let localEnv = {};
const wslDistro = () => process.env.KNOWLEDGE_WSL_DISTRO ?? localEnv.KNOWLEDGE_WSL_DISTRO ?? 'Ubuntu-22.04';

// Windows reaches the WSL-side services through the WSL NAT address. The
// Windows→WSL loopback relay cannot sustain pooled concurrent connections, so
// host-side endpoints must never point at 127.0.0.1.
async function endpointHost() {
  if (!windows) return '127.0.0.1';
  const output = await run('wsl.exe', ['-d', wslDistro(), '--exec', 'hostname', '-I'], { quiet: true, timeout: 15000 });
  const address = output.trim().split(/\s+/).find((token) => /^\d+(\.\d+){3}$/.test(token) && !token.startsWith('127.'));
  if (!address) throw new Error('Could not resolve the WSL address for development endpoints.');
  return address;
}

// The WSL NAT address changes across reboots; realign endpoint hosts in the
// gitignored env file so test suites keep a single source of truth.
function syncEndpoints(host) {
  let changed = false;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/).map((line) => {
    const updated = line
      .replace(/^(DATABASE_URL|DATABASE_ADMIN_URL|REDIS_URL)=(\S+@)[^:]+:/, `$1=$2${host}:`)
      .replace(/^(S3_ENDPOINT)=(\w+:\/\/)[^:]+:/, `$1=$2${host}:`);
    if (updated !== line) changed = true;
    return updated;
  });
  if (changed) {
    writeFileSync(envPath, lines.join('\n'));
    localEnv = loadLocalEnv();
    console.log(`Development endpoints in .env.fob.local updated to the current WSL address ${host}.`);
  }
}

function loadLocalEnv() {
  if (!existsSync(envPath)) throw new Error('Run node backend/server/scripts/knowledge-infra.mjs init first.');
  return Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function redact(value) {
  let safe = String(value);
  for (const [name, secret] of Object.entries(localEnv)) {
    if (secret && /PASSWORD|SECRET|ACCESS_KEY|DATABASE.*URL|REDIS_URL/.test(name)) safe = safe.replaceAll(secret, '[redacted]');
  }
  return safe;
}

function run(executable, args, { input, quiet = false, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = timeout ? setTimeout(() => child.kill(), timeout) : null;
    child.stdout.on('data', (chunk) => { stdout += chunk; if (!quiet) process.stdout.write(redact(chunk)); });
    child.stderr.on('data', (chunk) => { stderr += chunk; if (!quiet) process.stderr.write(redact(chunk)); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(redact(`${path.basename(executable)} exited ${code}: ${stderr || stdout}`)));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function linuxTool(tool, args, options) {
  return windows ? run('wsl.exe', ['-d', wslDistro(), '--exec', tool, ...args], options) : run(tool, args, options);
}

function compose(args, options) {
  return linuxTool('docker', ['compose', '--project-name', project, '--project-directory', linuxPath(root), '--env-file', linuxPath(envPath), '-f', linuxPath(path.join(root, 'compose.knowledge.yaml')), ...args], options);
}

async function keepWslAlive() {
  if (!windows) return;
  // systemd/Docker services alone do not keep a WSL distribution alive. Hold
  // one hidden client session; flock makes repeated `up` calls single-instance.
  // No global WSL setting or existing service is changed.
  await linuxTool('/usr/bin/flock', ['--version'], { quiet: true });
  const keeper = spawn('wsl.exe', ['-d', wslDistro(), '--exec', '/usr/bin/flock', '-n', '/tmp/fob-knowledge-dev.keepalive.lock', '/usr/bin/sleep', 'infinity'], {
    cwd: root, detached: true, windowsHide: true, stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    keeper.once('spawn', resolve);
    keeper.once('error', reject);
  });
  keeper.unref();
  console.log('WSL development keepalive requested (hidden session, single-instance lock).');
}

async function init() {
  if (existsSync(envPath)) {
    console.log('Using existing gitignored .env.fob.local; credentials unchanged.');
    localEnv = loadLocalEnv();
    return;
  }
  await run('git', ['check-ignore', '.env.fob.local'], { quiet: true });
  const password = () => randomBytes(32).toString('hex');
  const postgresPassword = password();
  const appPassword = password();
  const redisPassword = password();
  const host = await endpointHost();
  localEnv = {
    KNOWLEDGE_WSL_DISTRO: wslDistro(),
    ROLE: 'api,collab,mcp',
    FOB_WEB_PORT: '3001',
    FOB_SERVICE_PORT: '8721',
    BETTER_AUTH_URL: 'http://127.0.0.1:8721',
    BETTER_AUTH_SECRET: password(),
    FOB_AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:8721,http://localhost:8721',
    NEXT_PUBLIC_FOB_API_URL: 'http://127.0.0.1:8721',
    MEDIA_WORKER_URL: 'http://127.0.0.1:8730',
    MEDIA_WORKER_TOKEN: password(),
    FOB_POSTGRES_USER: 'fob_admin',
    FOB_POSTGRES_DB: 'fob',
    FOB_POSTGRES_PASSWORD: postgresPassword,
    FOB_DATABASE_APP_PASSWORD: appPassword,
    KNOWLEDGE_REDIS_PASSWORD: redisPassword,
    DATABASE_URL: `postgresql://fob_app:${appPassword}@${host}:55433/fob`,
    DATABASE_ADMIN_URL: `postgresql://fob_admin:${postgresPassword}@${host}:55433/fob`,
    REDIS_URL: `redis://:${redisPassword}@${host}:56380`,
    S3_ENDPOINT: `http://${host}:59010`,
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'fob-knowledge',
    S3_ACCESS_KEY_ID: `fob${randomBytes(10).toString('hex')}`,
    S3_SECRET_ACCESS_KEY: password(),
  };
  writeFileSync(envPath, `# Generated local development credentials. Do not commit.\n${Object.entries(localEnv).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created gitignored .env.fob.local with unique credentials (values not displayed).');
}

async function pullImage(image) {
  try {
    await linuxTool('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { quiet: true, timeout: 30000 });
    console.log(`Using local image ${image}.`);
    return;
  } catch { /* This fixed image is not present yet. */ }
  console.log(`Fetching official image ${image}.`);
  try {
    await linuxTool('docker', ['pull', image]);
  } catch (error) {
    console.log(`Docker pull did not complete; using the existing Skopeo registry transport for ${image}.`);
    try {
      await linuxTool('skopeo', ['copy', '--retry-times', '3', '--override-os', 'linux', '--override-arch', 'amd64', `docker://${image}`, `docker-daemon:${image}`]);
    } catch (fallbackError) {
      throw new AggregateError([error, fallbackError], `Unable to fetch official image ${image}.`);
    }
  }
}

async function initializeDatabase() {
  const appPassword = localEnv.FOB_DATABASE_APP_PASSWORD;
  if (!/^[a-f0-9]{64}$/.test(appPassword)) throw new Error('Local app credential has an unexpected format.');
  const sql = `CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_search;
CREATE EXTENSION IF NOT EXISTS ltree;
DO $bootstrap$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fob_app') THEN
    CREATE ROLE fob_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${appPassword}';
  END IF;
END $bootstrap$;
GRANT CONNECT ON DATABASE fob TO fob_app;
GRANT USAGE ON SCHEMA public, paradedb, pdb TO fob_app;
`;
  await compose(['exec', '-T', 'postgres', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', localEnv.FOB_POSTGRES_USER, '-d', localEnv.FOB_POSTGRES_DB], { input: sql, quiet: true });
  console.log('Database extensions and non-superuser runtime role are ready.');
}

const hash = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

async function s3(method, pathname, body = '') {
  const url = new URL(pathname, localEnv.S3_ENDPOINT);
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const payloadHash = hash(body);
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date };
  const signedHeaders = Object.keys(headers).join(';');
  const canonicalHeaders = Object.entries(headers).map(([key, value]) => `${key}:${value}\n`).join('');
  const canonical = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${localEnv.S3_REGION}/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${localEnv.S3_SECRET_ACCESS_KEY}`, day), localEnv.S3_REGION), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest('hex');
  return fetch(url, {
    method,
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${localEnv.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    ...(method === 'HEAD' || method === 'GET' ? {} : { body }),
    signal: AbortSignal.timeout(10000),
  });
}

async function verifyS3() {
  const health = await fetch(new URL('/minio/health/ready', localEnv.S3_ENDPOINT), { signal: AbortSignal.timeout(10000) });
  if (!health.ok) throw new Error(`MinIO health returned ${health.status}.`);
  const bucketPath = `/${localEnv.S3_BUCKET}`;
  const bucket = await s3('HEAD', bucketPath);
  if (bucket.status === 404) {
    const created = await s3('PUT', bucketPath);
    if (!created.ok) throw new Error(`S3 bucket creation returned ${created.status}.`);
  } else if (!bucket.ok) throw new Error(`S3 bucket probe returned ${bucket.status}.`);
  const probePath = `${bucketPath}/infrastructure-check/${randomUUID()}.txt`;
  const content = 'Fob knowledge infrastructure — signed S3 round trip.';
  const put = await s3('PUT', probePath, content);
  if (!put.ok) throw new Error(`S3 signed PUT returned ${put.status}.`);
  try {
    const get = await s3('GET', probePath);
    if (!get.ok || await get.text() !== content) throw new Error('S3 signed GET content did not match.');
  } finally {
    const removed = await s3('DELETE', probePath);
    if (!removed.ok) throw new Error(`S3 probe cleanup returned ${removed.status}.`);
  }
  console.log(`PASS S3: readiness, bucket access, signed PUT/GET/DELETE at ${localEnv.S3_ENDPOINT}.`);
}

function redisCommand(parts) {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
}

async function verifyRedis() {
  const url = new URL(localEnv.REDIS_URL);
  const key = `fob:infra:${randomUUID()}`;
  const value = 'knowledge-ready';
  const commands = [['AUTH', decodeURIComponent(url.password)], ['PING'], ['SET', key, value, 'EX', '30'], ['GET', key], ['DEL', key], ['QUIT']];
  const response = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    let result = '';
    socket.setTimeout(10000, () => socket.destroy(new Error('Redis check timed out.')));
    socket.on('connect', () => socket.write(commands.map(redisCommand).join('')));
    socket.on('data', (data) => { result += data; });
    socket.on('error', reject);
    socket.on('end', () => resolve(result));
  });
  const expected = `+OK\r\n+PONG\r\n+OK\r\n$${Buffer.byteLength(value)}\r\n${value}\r\n:1\r\n+OK\r\n`;
  if (response !== expected) throw new Error('Redis AUTH/PING/SET/GET/DEL did not match the expected result.');
  console.log(`PASS Redis: authenticated PING and expiring value round trip at ${url.hostname}:${url.port}.`);
}

async function verifyPostgres() {
  const sql = readFileSync(path.join(root, 'backend/server/scripts/knowledge-infra-check.sql'), 'utf8');
  const output = await compose(['exec', '-T', 'postgres', 'psql', '-X', '-qAt', '-U', localEnv.FOB_POSTGRES_USER, '-d', localEnv.FOB_POSTGRES_DB], { input: sql, quiet: true });
  const results = output.split(/\r?\n/).filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  const extensions = results.find((entry) => entry.extensions)?.extensions;
  const tokenizers = results.find((entry) => entry.jieba);
  const query = results.find((entry) => entry.chineseMatch);
  if (!extensions?.pg_search || !extensions?.vector || !extensions?.ltree || !tokenizers?.jieba.length || !tokenizers?.icu.length || query?.chineseMatch?.join() !== '1' || query?.englishMatch?.join() !== '1' || query?.vectorNearest !== 1 || query?.ltreeMatch !== 1) {
    throw new Error(`Postgres extension/query checks failed: ${JSON.stringify(results)}.`);
  }
  const url = new URL(localEnv.DATABASE_URL);
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    socket.setTimeout(5000, () => socket.destroy(new Error('Host Postgres port timed out.')));
    socket.on('connect', () => { socket.end(); resolve(); });
    socket.on('error', reject);
  });
  console.log(`PASS Postgres: ${JSON.stringify({ extensions, tokenizers, query })}; host port ${url.hostname}:${url.port} reachable.`);
  // Bun's built-in driver is used only for this development probe, never by
  // backend business code. It proves the Windows sidecar can authenticate over
  // TCP as the RLS-constrained runtime identity without adding a dependency.
  if (globalThis.Bun?.SQL) {
    const hostSql = new globalThis.Bun.SQL(localEnv.DATABASE_URL);
    try {
      const [identity] = await hostSql.unsafe('SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      if (identity?.role !== 'fob_app' || identity.rolsuper || identity.rolbypassrls) throw new Error('Host SQL connection must use the non-superuser runtime role.');
      const [tokens] = await hostSql.unsafe("SELECT '知识库协同编辑'::pdb.jieba::text[] AS tokens");
      if (!tokens?.tokens?.length) throw new Error('Host SQL tokenizer query returned no tokens.');
      console.log(`PASS Bun host SQL: authenticated as ${identity.role}, NOSUPERUSER/NOBYPASSRLS, jieba query successful.`);
    } finally {
      await hostSql.close();
    }
  }
}

async function main() {
  const command = process.argv[2] ?? 'status';
  if (!['init', 'up', 'verify', 'status'].includes(command)) throw new Error('Usage: knowledge-infra.mjs init|up|verify|status');
  if (command === 'init') return init();
  localEnv = loadLocalEnv();
  if (windows) syncEndpoints(await endpointHost());
  if (command === 'up') {
    await compose(['config', '--quiet'], { quiet: true });
    await keepWslAlive();
    for (const image of images) await pullImage(image);
    // Repeated cached builds must keep the same local image identity; otherwise
    // timestamped attestations cause an unnecessary MinIO container replacement.
    await compose(['build', '--provenance=false', 'minio']);
    await compose(['up', '-d', '--wait', '--wait-timeout', '120', '--pull', 'never']);
    await initializeDatabase();
  }
  if (command === 'up' || command === 'verify') {
    await verifyPostgres();
    await verifyRedis();
    await verifyS3();
  }
  await compose(['ps']);
}

main().catch((error) => {
  console.error(redact(error.message));
  if (error instanceof AggregateError) for (const cause of error.errors) console.error(redact(cause.message));
  process.exitCode = 1;
});
