import { expect, test } from 'bun:test';
import { resolveVerificationCallback } from './verification-url';

test('verification returns to Fob Web and rejects non-Web or credential-bearing origins', () => {
  expect(resolveVerificationCallback('http://localhost:3001')).toBe('http://localhost:3001/auth/verify?status=verified');
  expect(resolveVerificationCallback('https://book.example')).toBe('https://book.example/auth/verify?status=verified');
  for (const origin of ['http://tauri.localhost', 'https://app.test/path', 'https://user:secret@app.test', 'file:///app']) {
    expect(() => resolveVerificationCallback(origin)).toThrow();
  }
});
