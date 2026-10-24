// Real S3 -> HTTP -> isolated faster-whisper acceptance. No model API keys.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { MediaWorkerError } from '../.runtime/client.mjs';
import { createVerificationContext, hash } from './verification-storage.mjs';

const { client, bucket, objectRequest, presignedGet } = createVerificationContext();
const prefix = `/${bucket}/w02-verification/${randomUUID()}`;
const uploaded = [];
const evidence = { date: new Date().toISOString(), capabilities: await client.capabilities(), results: [], failures: [] };
assert.ok(evidence.capabilities.operations.includes('transcribe'), 'Restart the prepared worker before real Whisper acceptance.');

function assertSpeech(result) {
  const segments = result.derived.transcript;
  assert.ok(segments?.length, 'Real speech produced no transcript.');
  const text = segments.map((segment) => segment.text).join(' ').toLowerCase();
  assert.ok(text.includes('my fellow americans') && text.includes('your country') && text.includes('do for you'), 'Recognized real speech did not match the official source.');
  for (const segment of segments) assert.ok(segment.start >= 0 && segment.end >= segment.start && segment.end <= 11.05);
}

try {
  let audioRequest;
  for (const [filename, mime] of [['jfk.flac', 'audio/flac'], ['jfk-video.mp4', 'video/mp4']]) {
    const bytes = readFileSync(new URL(`../.cache/samples/${filename}`, import.meta.url));
    const path = `${prefix}/${filename}`;
    await objectRequest('PUT', path, bytes);
    uploaded.push(path);
    const request = { requestId: randomUUID(), operation: 'transcribe', language: 'en', timeoutMs: 60_000,
      resource: { ...presignedGet(path), sha256: hash(bytes), size: bytes.length, mime } };
    const result = await client.process(request);
    assertSpeech(result);
    evidence.results.push({ fixture: filename, ...result });
    console.log(`PASS real ${mime}: ${result.derived.transcript.length} timestamp segment(s), ${result.elapsedMs} ms, ${result.processor}.`);
    if (mime === 'audio/flac') audioRequest = request;
  }

  const badPath = `${prefix}/invalid.flac`;
  const invalid = Buffer.from('W02 deliberately corrupt media; not a recognition fixture.');
  await objectRequest('PUT', badPath, invalid);
  uploaded.push(badPath);
  await assert.rejects(client.process({ ...audioRequest, requestId: randomUUID(), resource: {
    ...presignedGet(badPath), mime: 'audio/flac', size: invalid.length, sha256: hash(invalid),
  } }), (error) => {
    assert.ok(error instanceof MediaWorkerError && error.code === 'invalid_media' && error.status === 422 && !error.retryable);
    evidence.failures.push({ case: 'corrupt media', code: error.code, status: error.status, retryable: error.retryable });
    return true;
  });

  await assert.rejects(client.process({ ...audioRequest, requestId: randomUUID(), timeoutMs: 1 }), (error) => {
    assert.ok(error instanceof MediaWorkerError && error.code === 'task_timeout' && error.status === 504 && error.retryable);
    evidence.failures.push({ case: 'overall HTTP task deadline (not asserted to be inference-stage)', code: error.code, status: error.status, retryable: error.retryable });
    return true;
  });
  await assert.rejects(client.process({ ...audioRequest, requestId: randomUUID(), language: 'zz' }), (error) => {
    assert.ok(error instanceof MediaWorkerError && error.code === 'unsupported_language' && error.status === 422 && !error.retryable);
    evidence.failures.push({ case: 'unsupported language', code: error.code, status: error.status, retryable: error.retryable });
    return true;
  });
  const retried = await client.process({ ...audioRequest, requestId: randomUUID() });
  assertSpeech(retried);
  evidence.results.push({ fixture: 'same real audio, new attempt after timeout', ...retried });
  const cancellation = new AbortController();
  const cancelTimer = setTimeout(() => cancellation.abort(), 200);
  try {
    await assert.rejects(client.process({ ...audioRequest, requestId: randomUUID() }, cancellation.signal),
      (error) => error instanceof MediaWorkerError && error.code === 'task_cancelled' && !error.retryable);
    evidence.failures.push({ case: 'caller abort with explicit server cancellation', code: 'task_cancelled', retryable: false });
  } finally { clearTimeout(cancelTimer); }
  console.log('PASS real HTTP failure/deadline/retry/cancellation protocol.');
} finally {
  for (const path of uploaded) await objectRequest('DELETE', path);
  console.log(`Removed ${uploaded.length} test-only S3 objects; local source fixtures remain cached.`);
}
writeFileSync(new URL('../.runtime/whisper-verification.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log('Saved credential-free .runtime/whisper-verification.json.');
