/** UTF-8 limits apply before data crosses the model boundary. */
export const agentLimits = Object.freeze({
  modelSteps: 8,
  toolCalls: 16,
  timeoutMs: 170_000,
  toolTimeoutMs: 20_000,
  answerCharacters: 64_000,
  transcriptBytes: 192_000,
  historyBytes: 20_000,
  initialContextBytes: 40_000,
  toolResultBytes: 20_000,
  retrievedBytes: 100_000,
  sources: 30,
  contextPages: 100,
});

export function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

/** Never splits a Unicode code point or produces a replacement character. */
export function clipUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

/** Bounded JSON, rather than a sliced JSON string with broken syntax. */
export function compactJson(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return clipUtf8(value, 2_000);
  if (depth >= 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 30).map(item => compactJson(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 60).map(([key, item]) => [clipUtf8(key, 200), compactJson(item, depth + 1)]));
  return null;
}

export { abortable } from '../abort';
