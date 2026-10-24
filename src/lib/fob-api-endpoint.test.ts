import { expect, test } from 'bun:test';
import { sameSiteDevelopmentOrigin } from './fob-api-endpoint';

test('localhost and IPv4 loopback share the browser cookie site across every Fob API', () => {
  const dev = (browserOrigin: string) => ({ isProduction: () => false, browserOrigin: () => browserOrigin });
  expect(sameSiteDevelopmentOrigin('http://127.0.0.1:8721', dev('http://localhost:3001'))).toBe('http://localhost:8721');
  expect(sameSiteDevelopmentOrigin('http://localhost:8721', dev('http://127.0.0.1:3001'))).toBe('http://127.0.0.1:8721');
  expect(sameSiteDevelopmentOrigin('https://api.fob.example', dev('http://localhost:3001'))).toBe('https://api.fob.example');
  expect(sameSiteDevelopmentOrigin('http://127.0.0.1:8721', { ...dev('http://localhost:3001'), isProduction: () => true })).toBe('http://127.0.0.1:8721');
});
