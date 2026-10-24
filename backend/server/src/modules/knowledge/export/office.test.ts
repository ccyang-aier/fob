import { describe, expect, test } from 'bun:test';
import { createOfficePreviewRoutes } from './office';
const origin = 'http://localhost:3000';
const ole = new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
const request = (body: Uint8Array = ole, headers: Record<string,string> = {}) => new Request('http://localhost:8711/api/knowledge/preview/doc', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/msword', ...headers }, body });
describe('legacy Word preview boundary', () => {
  test('returns no-store PDF only for valid format and trusted origin', async () => {
    const app = createOfficePreviewRoutes([origin], async () => new TextEncoder().encode('%PDF-1.7'));
    const response = await app.fetch(request());
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).toBe('%PDF-1.7');
  });
  test('rejects foreign origin, wrong type, malformed signature and oversized input without invoking Office', async () => {
    let calls=0; const app=createOfficePreviewRoutes([origin],async () => { calls++; return ole; });
    expect((await app.fetch(request(ole,{Origin:'https://foreign.test'}))).status).toBe(403);
    expect((await app.fetch(request(ole,{'Content-Type':'text/plain'}))).status).toBe(415);
    expect((await app.fetch(request(new Uint8Array([1,2,3])))).status).toBe(422);
    expect((await app.fetch(request(ole,{'Content-Length':String(32*1024*1024+1)}))).status).toBe(413);
    expect(calls).toBe(0);
  });
  test('limits simultaneous conversions and frees capacity after failure', async () => {
    let release!: () => void; const wait=new Promise<void>(resolve => { release=resolve; });
    const app=createOfficePreviewRoutes([origin],async () => { await wait; throw Object.assign(new Error(), {code:'ENOENT'}); });
    const first=app.fetch(request()); const second=app.fetch(request());
    await new Promise(resolve => setTimeout(resolve,0));
    expect((await app.fetch(request())).status).toBe(429);
    release(); expect((await first).status).toBe(503); expect((await second).status).toBe(503);
    expect((await app.fetch(request())).status).toBe(503);
  });
});
