import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

type PublicationIdentity = { knowledgeBaseId: string; pageId: string; id: string };
const key = (secret: string) => createHash('sha256').update(`fob:publication:v1:${secret}`).digest();
const aad = (identity: PublicationIdentity) => Buffer.from(`${identity.knowledgeBaseId}:${identity.pageId}:${identity.id}`);
/** Stable links are recoverable only by authorized managers, encrypted at rest. */
export function encryptPublicationToken(secret: string, identity: PublicationIdentity, token: string): Uint8Array {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), nonce);
  cipher.setAAD(aad(identity));
  const payload = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), payload]);
}
export function decryptPublicationToken(secret: string, identity: PublicationIdentity, encrypted: Uint8Array): string {
  const data = Buffer.from(encrypted);
  const cipher = createDecipheriv('aes-256-gcm', key(secret), data.subarray(0, 12));
  cipher.setAAD(aad(identity));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
