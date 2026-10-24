import { createTransport } from 'nodemailer';
import { z } from 'zod';
import { FobAuthConfigurationError } from './config';

export interface VerificationEmail {
  to: string;
  url: string;
}

/** Injected capture transports are for tests; production uses configured SMTP. */
export interface AuthEmailTransport {
  sendVerification(message: VerificationEmail): Promise<void>;
}

type MailSubmission = { from: string; to: string; subject: string; text: string };

export function createVerificationEmailTransport(from: string, submit: (message: MailSubmission) => Promise<unknown>): AuthEmailTransport {
  if (!z.email().safeParse(from).success) throw new FobAuthConfigurationError('SMTP_FROM');
  return {
    async sendVerification({ to, url }) {
      try {
        await submit({ from, to, subject: '验证你的 Fob 邮箱', text: `请打开以下链接验证你的邮箱。链接在 1 小时后失效。\n\n${url}\n\n如果这不是你的操作，请忽略本邮件。` });
      } catch {
        // SMTP errors may contain credentials, recipient addresses, or content.
        throw new Error('Verification email delivery failed. Please retry later.');
      }
    },
  };
}

const smtpSchema = z.object({
  SMTP_HOST: z.string().trim().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USERNAME: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.email(),
}).superRefine((config, context) => {
  if (Boolean(config.SMTP_USERNAME) !== Boolean(config.SMTP_PASSWORD)) context.addIssue({ code: 'custom', path: ['SMTP_USERNAME'], message: 'SMTP credentials must be configured together' });
});

/** TLS is mandatory; there is no console-mail or plaintext production fallback. */
export function createSmtpAuthEmailTransport(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = smtpSchema.safeParse(environment);
  if (!parsed.success) throw new FobAuthConfigurationError([...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', '));
  const config = parsed.data;
  const secure = config.SMTP_SECURE ? config.SMTP_SECURE === 'true' : config.SMTP_PORT === 465;
  const transport = createTransport({
    host: config.SMTP_HOST, port: config.SMTP_PORT, secure, requireTLS: !secure,
    auth: config.SMTP_USERNAME ? { user: config.SMTP_USERNAME, pass: config.SMTP_PASSWORD! } : undefined,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
  return {
    ...createVerificationEmailTransport(config.SMTP_FROM, (message) => transport.sendMail(message)),
    async verify() {
      try { await transport.verify(); } catch { throw new Error('Authentication SMTP connection could not be verified.'); }
    },
    close() { transport.close(); },
  };
}
