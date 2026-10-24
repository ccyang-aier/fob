import { describe, expect, test } from 'bun:test';
import { readFobAuthConfig, validateFobAuthConfig } from './config';
import { createSmtpAuthEmailTransport, createVerificationEmailTransport } from './email';

const defaults = { baseUrl: 'http://localhost:8721', secret: 'a'.repeat(40), trustedOrigins: ['http://localhost:3001'] };

describe('explicit authentication transport configuration', () => {
  test('same-site local Web and HTTPS cross-site Web are separate valid modes', () => {
    expect(validateFobAuthConfig(defaults).cookieMode).toBe('same-site');
    const remote = validateFobAuthConfig({ ...defaults, baseUrl: 'https://auth.example.test', trustedOrigins: ['https://app.example.test'], cookieMode: 'cross-site', production: true });
    expect(remote.trustedOrigins).toHaveLength(2);
    expect(readFobAuthConfig({ BETTER_AUTH_URL: defaults.baseUrl, BETTER_AUTH_SECRET: defaults.secret, FOB_AUTH_TRUSTED_ORIGINS: defaults.trustedOrigins.join(',') }).trustedOrigins).toEqual([defaults.baseUrl, ...defaults.trustedOrigins]);
  });

  test('rejects wildcard, opaque, path, insecure production and impossible cross-site configurations', () => {
    for (const change of [
      { trustedOrigins: ['*'] }, { trustedOrigins: ['null'] }, { trustedOrigins: ['https://example.test/path'] }, { trustedOrigins: ['tauri://localhost'] },
      { trustedOrigins: ['https://user:private@example.test'] },
      { cookieMode: 'cross-site' as const }, { production: true }, { baseUrl: 'http://external.example.test' },
      { baseUrl: 'http://localhost:8710/private?secret=value' }, { secret: 'short-secret' },
      { baseUrl: 'https://auth.example.test', production: true, trustedOrigins: ['http://app.example.test'] },
    ]) expect(() => validateFobAuthConfig({ ...defaults, ...change })).toThrow('Invalid Fob authentication configuration');
  });

  test('production SMTP must be configured and delivery failures never contain credentials or verification URLs', async () => {
    expect(() => createSmtpAuthEmailTransport({})).toThrow('SMTP_HOST');
    expect(() => createSmtpAuthEmailTransport({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_FROM: 'fob@example.test', SMTP_USERNAME: 'private' })).toThrow('SMTP_USERNAME');
    const email = createVerificationEmailTransport('fob@example.test', async () => { throw new Error('smtp://password@host verify?token=secret'); });
    await expect(email.sendVerification({ to: 'person@example.test', url: 'https://auth.example.test/verify?token=secret' })).rejects.toThrow('Verification email delivery failed. Please retry later.');
  });
});
