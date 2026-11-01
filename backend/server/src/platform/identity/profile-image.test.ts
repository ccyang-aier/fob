import { expect, test } from 'bun:test';
import { validProfileImage } from './profile-image';

const origins = new Set(['http://localhost:3001','https://fob.example.test']);
const pixel = 'data:image/webp;base64,UklGRjYAAABXRUJQVlA4ICoAAACwAQCdASoBAAEAAUAmJaACdLoABdQAAP6k1/8lP67vKLtc/xbSOhSeAAA=';

test('avatars accept a normalized upload, a trusted catalog entry and explicit reset', () => {
  expect(validProfileImage(pixel,origins)).toBe(true);
  expect(validProfileImage(null,origins)).toBe(true);
  for (const family of ['pets','sketches','landscapes']) for (let number=1;number<=8;number++) expect(validProfileImage(`https://fob.example.test/avatars/v1/${family}-0${number}.webp`,origins)).toBe(true);
});

test('avatars reject foreign origins, path tricks, active content and unbounded inline payloads', () => {
  for (const image of ['https://fob.example.test.evil/avatars/v1/pets-01.webp','https://evil.test/avatars/v1/pets-01.webp','https://fob.example.test/avatars/v1/pets-09.webp','https://fob.example.test/avatars/v1/pets-01.webp?track=1','https://fob.example.test/avatars/v1/pets-01.webp#fragment','javascript:alert(1)','data:image/svg+xml,<svg/>','data:image/webp;base64,PGh0bWw+',pixel+'a'.repeat(12_000),42,{}]) expect(validProfileImage(image,origins)).toBe(false);
});

test('inline images reject malformed lengths, oversized dimensions and animation metadata', () => {
  const bytes = Buffer.from(pixel.slice(23),'base64');
  bytes.writeUInt16LE(8192,26);
  expect(validProfileImage('data:image/webp;base64,'+bytes.toString('base64'),origins)).toBe(false);
  const animated = Buffer.alloc(30);
  animated.write('RIFF',0); animated.writeUInt32LE(22,4); animated.write('WEBPVP8X',8); animated[20] = 2;
  expect(validProfileImage('data:image/webp;base64,'+animated.toString('base64'),origins)).toBe(false);
  bytes.writeUInt32LE(0,4);
  expect(validProfileImage('data:image/webp;base64,'+bytes.toString('base64'),origins)).toBe(false);
});
