import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
let local = {};
try { local = parseEnv(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
process.stdout.write(process.env.NEXT_PUBLIC_FOB_API_URL ?? local.NEXT_PUBLIC_FOB_API_URL ?? '');
