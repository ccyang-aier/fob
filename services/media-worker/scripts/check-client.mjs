import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMediaWorkerClient, MediaWorkerError } from '../.runtime/client.mjs';

const environment = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
const baseUrl = `http://127.0.0.1:${environment.MEDIA_WORKER_PORT}`;
const client = createMediaWorkerClient({ baseUrl, token: environment.MEDIA_WORKER_TOKEN });
assert.equal((await client.health()).status, 'ok');
const capabilities = await client.capabilities();
assert.ok(Array.isArray(capabilities.operations));
const unauthorized = createMediaWorkerClient({ baseUrl, token: 'wrong-token-'.repeat(4) });
await assert.rejects(unauthorized.capabilities(), (error) => error instanceof MediaWorkerError && error.code === 'unauthorized');
const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
const expiresAt = new Date(issuedAt.getTime() + 300_000).toISOString();
const query = new URLSearchParams({ 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Date': issuedAt.toISOString().replace(/[:-]|\.\d{3}/g, ''),
  'X-Amz-Expires': '300', 'X-Amz-Signature': 'a'.repeat(64), 'X-Amz-Credential': 'protocol-check/date/region/s3/aws4_request', 'X-Amz-SignedHeaders': 'host' });
if (!capabilities.operations.includes('parse_document')) {
  await assert.rejects(client.process({ requestId: randomUUID(), operation: 'parse_document', resource: {
    url: `${environment.MEDIA_WORKER_DOWNLOAD_ORIGINS.split(',')[0]}/protocol-fixture.pdf?${query}`, expiresAt,
    sha256: createHash('sha256').update('probe').digest('hex'), size: 5, mime: 'application/pdf',
  } }), (error) => error instanceof MediaWorkerError && error.code === 'processor_unavailable');
}
console.log(`PASS Node ${process.version}: real Media Worker health/capabilities/auth/error contract; registered operations=${JSON.stringify(capabilities.operations)}.`);
