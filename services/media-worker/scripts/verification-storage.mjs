// Test-only S3 transport for real media acceptance, never imported by the worker.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMediaWorkerClient } from '../.runtime/client.mjs';

export const hash = (value) => createHash('sha256').update(value).digest('hex');

function environment(url) {
  return Object.fromEntries(readFileSync(url, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

export function createVerificationContext() {
  const worker = environment(new URL('../.env.local', import.meta.url));
  const storage = environment(new URL('../../../.env.fob.local', import.meta.url));
  const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
  const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const signingKey = (day) => hmac(hmac(hmac(hmac(`AWS4${storage.S3_SECRET_ACCESS_KEY}`, day), storage.S3_REGION), 's3'), 'aws4_request');

  function presignedGet(path) {
    const issued = new Date(Math.floor(Date.now() / 1000) * 1000);
    const date = issued.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = date.slice(0, 8);
    const scope = `${day}/${storage.S3_REGION}/s3/aws4_request`;
    const url = new URL(path, storage.S3_ENDPOINT);
    const values = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${storage.S3_ACCESS_KEY_ID}/${scope}`,
      'X-Amz-Date': date, 'X-Amz-Expires': '300', 'X-Amz-SignedHeaders': 'host' };
    const query = Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
    const canonical = ['GET', url.pathname, query, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const signature = createHmac('sha256', signingKey(day)).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest('hex');
    url.search = `${query}&X-Amz-Signature=${signature}`;
    return { url: url.href, expiresAt: new Date(issued.getTime() + 300_000).toISOString() };
  }

  async function objectRequest(method, path, body = Buffer.alloc(0)) {
    const url = new URL(path, storage.S3_ENDPOINT);
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = date.slice(0, 8);
    const scope = `${day}/${storage.S3_REGION}/s3/aws4_request`;
    const payloadHash = hash(body);
    const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date };
    const names = Object.keys(headers).join(';');
    const canonical = [method, url.pathname, '', Object.entries(headers).map(([key, value]) => `${key}:${value}\n`).join(''), names, payloadHash].join('\n');
    const signature = createHmac('sha256', signingKey(day)).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest('hex');
    const response = await fetch(url, { method, body, signal: AbortSignal.timeout(10_000), headers: {
      ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${storage.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
    } });
    await response.body?.cancel();
    assert.ok(response.ok, `S3 ${method} failed with HTTP ${response.status}.`);
  }
  return { bucket: storage.S3_BUCKET, objectRequest, presignedGet,
    client: createMediaWorkerClient({ baseUrl: `http://127.0.0.1:${worker.MEDIA_WORKER_PORT}`, token: worker.MEDIA_WORKER_TOKEN }) };
}
