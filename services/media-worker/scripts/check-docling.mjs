// Real generated PDF/Office -> S3 -> HTTP -> Docling. No inference doubles.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { MediaWorkerError } from '../.runtime/client.mjs';
import { createVerificationContext, hash } from './verification-storage.mjs';

const { client, bucket, objectRequest, presignedGet } = createVerificationContext();
const formats = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const prefix = `/${bucket}/w03-verification/${randomUUID()}`;
const uploaded = [];
const evidence = { date: new Date().toISOString(), capabilities: await client.capabilities(), results: [], failures: [] };
assert.ok(evidence.capabilities.operations.includes('parse_document'), 'Prepare models and restart the worker before Docling acceptance.');

async function resource(filename, mime, bytes = readFileSync(new URL(`../.cache/documents/${filename}`, import.meta.url))) {
  const path = `${prefix}/${filename}`;
  await objectRequest('PUT', path, bytes);
  uploaded.push(path);
  return { requestId: randomUUID(), operation: 'parse_document', timeoutMs: 90_000,
    resource: { ...presignedGet(path), sha256: hash(bytes), size: bytes.length, mime } };
}

function assertDocument(result, extension) {
  const markdown = result.derived.markdown;
  assert.ok(markdown.includes('Fob Knowledge Report') && markdown.includes('Alpha') && markdown.includes('Beta'));
  assert.ok(/\|[^\n]*Count[^\n]*\|/.test(markdown) && markdown.includes('Ready') && markdown.includes('Review'));
  if (extension !== 'xlsx') assert.match(markdown, /^#{1,6} /m); // Excel cells are tables, not invented headings.
  assert.ok(markdown.includes('Figure 1. Capacity chart.'));
  assert.ok(!markdown.includes('data:') && !markdown.includes('file:'));
  assert.equal(result.attachments.length, 1);
  for (const attachment of result.attachments) {
    const bytes = Buffer.from(attachment.dataBase64, 'base64');
    assert.equal(hash(bytes), attachment.sha256);
    assert.equal(bytes.length, attachment.size);
    assert.ok(attachment.width > 100 && attachment.height > 100);
    assert.ok(markdown.includes(`asset:${attachment.sha256}`));
    // Recovered pixels are QA intermediates only; not business assets or storage writes.
    writeFileSync(new URL(`../.runtime/docling-${extension}.png`, import.meta.url), bytes);
  }
}

try {
  let pdfRequest;
  for (const [extension, mime] of Object.entries(formats)) {
    const request = await resource(`report.${extension}`, mime);
    const result = await client.process(request);
    assertDocument(result, extension);
    const attachments = result.attachments.map((attachment) => Object.fromEntries(Object.entries(attachment).filter(([key]) => key !== 'dataBase64')));
    evidence.results.push({ fixture: `report.${extension}`, ...result, attachments });
    console.log(`PASS real ${extension}: structured Markdown + ${attachments.length} extracted PNG, ${result.elapsedMs} ms.`);
    if (extension === 'pdf') pdfRequest = request;
    for (const kind of ['empty', 'corrupt']) {
      const badRequest = await resource(`${kind}.${extension}`, mime,
        kind === 'empty' ? undefined : Buffer.from('Deliberately corrupt W03 input, not a document container.'));
      await assert.rejects(client.process(badRequest), (error) => {
        assert.ok(error instanceof MediaWorkerError && error.code === `${kind === 'empty' ? 'empty' : 'invalid'}_document` && error.status === 422 && !error.retryable);
        evidence.failures.push({ fixture: `${kind}.${extension}`, code: error.code, status: error.status, retryable: error.retryable });
        return true;
      });
    }
  }
  await assert.rejects(client.process({ ...pdfRequest, requestId: randomUUID(), timeoutMs: 1 }), (error) => {
    assert.ok(error instanceof MediaWorkerError && error.code === 'task_timeout' && error.retryable);
    evidence.failures.push({ case: 'overall HTTP deadline, not asserted to occur during model inference', code: error.code, status: error.status });
    return true;
  });
  const retried = await client.process({ ...pdfRequest, requestId: randomUUID() });
  assertDocument(retried, 'pdf');
  evidence.results.push({ fixture: 'PDF new attempt after deadline', elapsedMs: retried.elapsedMs, processor: retried.processor });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 200);
  try {
    await assert.rejects(client.process({ ...pdfRequest, requestId: randomUUID() }, controller.signal),
      (error) => error instanceof MediaWorkerError && error.code === 'task_cancelled');
    evidence.failures.push({ case: 'caller abort plus explicit server cancellation', code: 'task_cancelled' });
  } finally { clearTimeout(timer); }
  console.log('PASS real empty/corrupt documents, deadline, new attempt and cancellation.');
} finally {
  const cleanup = await Promise.allSettled(uploaded.map((path) => objectRequest('DELETE', path)));
  assert.ok(cleanup.every((result) => result.status === 'fulfilled'), 'Test-only object cleanup failed; do not claim a clean run.');
  console.log(`Removed ${uploaded.length} test-only S3 objects; no business assets were persisted.`);
}
writeFileSync(new URL('../.runtime/docling-verification.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log('Saved credential-free .runtime/docling-verification.json (attachment bytes excluded).');
