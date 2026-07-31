import crypto from 'crypto';
import { env } from '../config/env';

/**
 * AES-256-GCM at-rest encryption for the one class of secret this app must
 * store reversibly: a BioStar 2 device password. Everything else secret
 * (user passwords, device API keys) is a hash we only ever compare against,
 * never read back — but syncing a Suprema device means logging into BioStar 2
 * on every poll, which needs the plaintext password back out.
 *
 * ENCRYPTION_KEY can be any length; it's hashed down to a 256-bit key so the
 * env var doesn't have to be a precise hex string.
 */
const KEY = crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest();
const IV_LENGTH = 12; // GCM standard nonce size

/** Returns `iv:authTag:ciphertext`, all hex — a single string safe for one TEXT column. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decrypt(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted value');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
