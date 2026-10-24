import { describe, expect, test } from 'bun:test';
import { knowledgeTrpcUrl,  } from './endpoint';
import { createFobOriginProvider, fobApiDevOrigin, fobApiUrlEnvName, parseFobApiOrigin, resolveFobApiOrigin, type FobEndpointDeps } from '@/lib/fob-api-endpoint';

const knowledgeBase = '20000000-0000-4000-8000-000000000000';

function deps(overrides: Partial<FobEndpointDeps> = {}): FobEndpointDeps {
  return {
    runtime: () => 'web',
    environmentUrl: () => undefined,
    isProduction: () => false,
    ...overrides,
  };
}

describe('parseFobApiOrigin', () => {
  test('accepts http and https origins and normalizes a trailing slash', () => {
    expect(parseFobApiOrigin('https://api.fob.example')).toBe('https://api.fob.example');
    expect(parseFobApiOrigin('https://api.fob.example/')).toBe('https://api.fob.example');
    expect(parseFobApiOrigin('http://127.0.0.1:8721')).toBe('http://127.0.0.1:8721');
  });

  test('rejects paths, queries, fragments, credentials, other schemes and non-URLs', () => {
    for (const raw of ['https://api.example/api', 'https://api.example/?x=1', 'https://api.example/#f', 'https://user:pass@api.example', 'ws://api.example', 'not a url']) {
      expect(() => parseFobApiOrigin(raw)).toThrow('Invalid Fob API origin');
    }
  });
});

describe('knowledgeTrpcUrl', () => {
  test('builds the A00 transport URL for one knowledgeBase', () => {
    expect(knowledgeTrpcUrl('https://api.fob.example', knowledgeBase)).toBe(`https://api.fob.example/api/knowledge/${knowledgeBase}/trpc`);
  });

  test('validates the origin and the knowledgeBaseId', () => {
    expect(() => knowledgeTrpcUrl('https://api.example/path', knowledgeBase)).toThrow('Invalid Fob API origin');
    expect(() => knowledgeTrpcUrl('https://api.fob.example', 'not-a-uuid')).toThrow('knowledgeBaseId must be a UUID');
  });
});

describe('resolveFobApiOrigin', () => {
  test('web uses the configured deployment origin', async () => {
    const origin = await resolveFobApiOrigin(deps({ environmentUrl: () => 'https://knowledge.internal.example/' }));
    expect(origin).toEqual({ origin: 'https://knowledge.internal.example', source: 'configured' });
  });

  test('an invalid configured origin is a clear endpoint error naming the variable', async () => {
    const invalid = resolveFobApiOrigin(deps({ environmentUrl: () => 'https://api.example/api' }));
    await expect(invalid).rejects.toMatchObject({ code: 'ENDPOINT' });
    const error = await invalid.catch((cause) => cause);
    expect(error.code).toBe('ENDPOINT');
    expect(error.message).toContain(fobApiUrlEnvName);
  });

  test('development uses the independent Fob API; production requires configuration', async () => {
    expect(fobApiDevOrigin).toBe('http://127.0.0.1:8721');
    expect(await resolveFobApiOrigin(deps())).toEqual({ origin: fobApiDevOrigin, source: 'dev' });
    await expect(resolveFobApiOrigin(deps({ isProduction: () => true }))).rejects.toMatchObject({ code: 'ENDPOINT' });
  });

  test('the data layer is browser-only', async () => {
    await expect(resolveFobApiOrigin(deps({ runtime: () => 'server' }))).rejects.toMatchObject({ code: 'ENDPOINT' });
  });

  test('the provider memoizes: the environment is inspected once per document', async () => {
    let environmentCalls = 0;
    const provider = createFobOriginProvider(deps({ environmentUrl: () => { environmentCalls += 1; return 'https://api.fob.example'; } }));
    await provider();
    await provider();
    expect(environmentCalls).toBe(1);
  });
});
