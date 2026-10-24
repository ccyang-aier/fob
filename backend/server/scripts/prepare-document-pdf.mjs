import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';

/** pnpm blocks dependency postinstall; explicitly prepare the matching browser once. */
export async function prepareDocumentPdf() {
  if (existsSync(await puppeteer.executablePath())) return;
  console.log('PDF: installing the document rendering browser (cached for subsequent starts).');
  const require = createRequire(import.meta.url);
  const cli = require.resolve('puppeteer/internal/node/cli.js');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'browsers', 'install', 'chrome'], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('PDF browser installation failed.')));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareDocumentPdf();
