import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env.fob.local');
if (!existsSync(envPath)) throw new Error('Run pnpm dev:init first.');
const configured = { ...parseEnv(readFileSync(envPath, 'utf8')), ...process.env };
if (!configured.MEDIA_WORKER_TOKEN || !configured.S3_ENDPOINT) throw new Error('Configure the independent Fob media token and object storage.');
const workerRoot = path.join(root, 'services/media-worker');
const virtualPython = path.join(workerRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = configured.FOB_PYTHON_PATH ?? (existsSync(virtualPython) ? virtualPython : 'python');
const endpoint = new URL(configured.MEDIA_WORKER_URL ?? 'http://127.0.0.1:8920');
const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|home|userprofile|appdata|localappdata|lang|lc_all|pythonpath|pythonhome|cuda_visible_devices|hf_home|huggingface_hub_cache|transformers_cache)$/i.test(name),
));
const child = spawn(python, ['-m', 'media_worker'], {
  cwd: workerRoot,
  windowsHide: true,
  stdio: 'inherit',
  env: {
    ...inherited,
    ...Object.fromEntries(Object.entries(configured).filter(([name]) => name.startsWith('MEDIA_WORKER_'))),
    MEDIA_WORKER_HOST: endpoint.hostname,
    MEDIA_WORKER_PORT: endpoint.port || '8920',
    MEDIA_WORKER_DOWNLOAD_ORIGINS: new URL(configured.S3_ENDPOINT).origin,
  },
});
child.on('error', error => { console.error(`Fob media worker could not start: ${error.code ?? error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
