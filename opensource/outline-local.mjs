import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.join(directory, 'outline');
const envFile = path.join(directory, '.env.outline.local');
const windows = process.platform === 'win32';
const distro = process.env.OUTLINE_WSL_DISTRO || 'Ubuntu-22.04';
const linuxPath = (value) => windows ? value.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/') : value;

function run(executable, args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; if (!quiet) process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { if (!quiet) process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`${executable} exited with code ${code}.`)));
  });
}

function docker(args, options) {
  return windows ? run('wsl.exe', ['-d', distro, '--exec', 'docker', ...args], options) : run('docker', args, options);
}

function compose(args, options) {
  return docker(['compose', '--project-directory', linuxPath(directory), '--env-file', linuxPath(envFile), '-f', linuxPath(path.join(directory, 'compose.outline.yaml')), ...args], options);
}

async function initialize() {
  if (!existsSync(path.join(checkout, '.git'))) {
    throw new Error('Clone https://github.com/outline/outline.git into opensource/outline first.');
  }
  const commit = await run('git', ['-C', checkout, 'rev-parse', 'HEAD'], { quiet: true });
  if (existsSync(envFile)) {
    const previous = readFileSync(envFile, 'utf8');
    writeFileSync(envFile, previous.replace(/^OUTLINE_SOURCE_COMMIT=.*$/m, `OUTLINE_SOURCE_COMMIT=${commit}`));
    console.log('Using existing local credentials.');
    return;
  }
  await run('git', ['check-ignore', envFile], { quiet: true });
  const key = () => randomBytes(32).toString('hex');
  writeFileSync(envFile, `# Local credentials; do not commit.\nOUTLINE_SOURCE_COMMIT=${commit}\nOUTLINE_POSTGRES_PASSWORD=${key()}\nSECRET_KEY=${key()}\nUTILS_SECRET=${key()}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Created ignored local credentials.');
}

async function keepAlive() {
  if (!windows) return;
  const child = spawn('wsl.exe', ['-d', distro, '--exec', 'flock', '-n', '/tmp/fob-outline-local.keepalive.lock', 'sleep', 'infinity'], {
    cwd: directory, windowsHide: true, detached: true, stdio: 'ignore',
  });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}

async function main() {
  const command = process.argv[2] || 'status';
  if (command === 'init') return initialize();
  if (command === 'build') {
    await initialize();
    return compose(['--progress=plain', 'build', 'outline']);
  }
  if (!existsSync(envFile)) throw new Error('Run node opensource/outline-local.mjs init first.');
  if (command === 'up') {
    await keepAlive();
    await compose(['up', '-d', '--wait', '--wait-timeout', '180']);
    await compose(['exec', '-T', 'outline', 'node', '/opt/fob/outline-bootstrap.mjs']);
    console.log('Outline: http://localhost:3802 | Local mail: http://localhost:3803 | Login: admin@outline.local');
    return;
  }
  if (command === 'status') return compose(['ps']);
  if (command === 'down') return compose(['down']);
  if (command === 'logs') return compose(['logs', '--tail', '100', 'outline']);
  throw new Error('Usage: node opensource/outline-local.mjs init|build|up|status|logs|down');
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
