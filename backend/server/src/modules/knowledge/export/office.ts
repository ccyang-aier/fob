import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { hasTrustedFobOrigin } from '../../../platform/identity/config';

const run = promisify(execFile);
const path = '/api/knowledge/preview/doc';
export function officeExecutable() {
  if (process.env.FOB_OFFICE_EXECUTABLE) return process.env.FOB_OFFICE_EXECUTABLE;
  if (process.platform === 'win32') {
    const installed = join(process.env.ProgramFiles ?? 'C:/Program Files', 'LibreOffice/program/soffice.com');
    return existsSync(installed) ? installed.replaceAll('\\', '/') : 'soffice.com';
  }
  return process.platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : 'libreoffice';
}
/** Each conversion uses an isolated profile, disables macros/updates and removes all bytes afterwards. */
export async function renderLegacyWord(bytes: Uint8Array): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'fob-doc-preview-'));
  try {
    const profile = join(directory, 'profile');
    await mkdir(join(profile, 'user'), { recursive: true });
    await writeFile(join(profile, 'user/registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>');
    const file = join(directory, 'source.doc');
    await writeFile(file, bytes);
    await run(officeExecutable(), [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', directory, file], { timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const pdf = await readFile(join(directory, 'source.pdf'));
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid converted document');
    return pdf;
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('fob-doc-preview-')) throw new Error('Invalid conversion cleanup path');
    await rm(directory, { recursive: true, force: true });
  }
}

export function createOfficePreviewRoutes(origins: readonly string[], render = renderLegacyWord) {
  const app = new Hono(); let active = 0;
  app.use(path, cors({ origin: origin => origins.includes(origin) ? origin : undefined, allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
  app.use(path, async (context, next) => {
    context.header('Cache-Control', 'no-store');
    if (!hasTrustedFobOrigin(context.req.raw, origins)) return context.json({ code: 'INVALID_ORIGIN' }, 403);
    await next();
  });
  app.use(path, bodyLimit({ maxSize: 32 * 1024 * 1024, onError: context => context.json({ code: 'FILE_TOO_LARGE' }, 413) }));
  app.post(path, async context => {
    if (context.req.header('content-type')?.split(';')[0].trim() !== 'application/msword') return context.json({ code: 'INVALID_CONTENT_TYPE' }, 415);
    if (active >= 2) return context.json({ code: 'PREVIEW_BUSY' }, 429);
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (!ole.every((byte, index) => bytes[index] === byte)) return context.json({ code: 'INVALID_DOC' }, 422);
    active++;
    try {
      const pdf = await render(bytes);
      return new Response(pdf as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': context.req.header('origin')! } });
    } catch (error) {
      return context.json({ code: error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 'OFFICE_UNAVAILABLE' : 'DOC_RENDER_FAILED' }, 503);
    } finally { active--; }
  });
  return app;
}
