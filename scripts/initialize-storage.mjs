// SigV4 bootstrap copied from backend/server/scripts/knowledge-infra.mjs.
// This command only creates the explicitly configured product bucket.
import { createHash, createHmac } from 'node:crypto';

const required = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
if (required.some(name => !process.env[name])) throw new Error('Set all Fob S3 configuration fields before bucket initialization.');
const { S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secret } = process.env;
if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid product bucket name.');
const origin = new URL(endpoint);
if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('S3_ENDPOINT must be an HTTP(S) origin.');
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

async function request(method) {
  const url = new URL(`/${bucket}`, endpoint);
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8), payloadHash = hash('');
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date };
  const signedHeaders = Object.keys(headers).join(';');
  const canonicalHeaders = Object.entries(headers).map(([key, value]) => `${key}:${value}\n`).join('');
  const canonical = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest('hex');
  return fetch(url, { method, headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }, signal: AbortSignal.timeout(10_000) });
}

try {
  const probe = await request('HEAD');
  if (probe.status === 404) {
    const created = await request('PUT');
    if (!created.ok) throw new Error();
  } else if (!probe.ok) throw new Error();
  console.log('The configured Fob object-storage bucket is ready.');
} catch { throw new Error('Fob bucket initialization failed; check the configured endpoint, credentials and region.'); }
