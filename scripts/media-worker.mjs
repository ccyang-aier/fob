import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, watch } from 'node:fs';
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
const childOptions = {
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
};
let child;
let stopping = false;
let timer;
let restart = Promise.resolve();

function start() {
  const current = spawn(python, ['-m', 'media_worker'], childOptions);
  child = current;
  current.on('error', error => {
    console.error(`Fob media worker could not start: ${error.code ?? error.message}`);
  });
  current.on('exit', code => {
    if (child === current && !stopping) {
      console.error(`Fob media worker exited (${code}); waiting for a Python source change.`);
    }
  });
}

async function stop() {
  const previous = child;
  child = undefined;
  if (!previous?.pid || previous.exitCode !== null || previous.signalCode !== null) return;
  const exited = new Promise(resolve => previous.once('exit', resolve));
  if (process.platform === 'win32') {
    // The venv launcher owns another Python process on Windows. Stop only
    // this launcher's tree; hidden Uvicorn reload sessions cannot use Ctrl+C.
    await new Promise((resolve, reject) => {
      execFile('taskkill.exe', ['/PID', String(previous.pid), '/T', '/F'], { windowsHide: true }, error => {
        if (error && previous.exitCode === null) reject(new Error('Could not stop the Fob media worker process tree.'));
        else resolve();
      });
    });
  } else previous.kill('SIGTERM');
  await exited;
}

const watcher = watch(path.join(workerRoot, 'media_worker'), { recursive: true }, (_event, filename) => {
  if (stopping || (filename && !filename.endsWith('.py'))) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    restart = restart.then(async () => {
      if (stopping) return;
      console.log('Fob media worker: Python source changed; restarting.');
      await stop();
      if (!stopping) start();
    }).catch(error => console.error(error.message));
  }, 300);
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  watcher.close();
  await restart;
  await stop();
}

watcher.on('error', error => {
  console.error(`Fob media worker watcher failed: ${error.code ?? error.message}`);
  process.exitCode = 1;
  void shutdown();
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(); });
start();
console.log(`Fob media worker: watching Python sources at ${endpoint.origin}.`);
