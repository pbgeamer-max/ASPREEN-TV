import * as crypto from 'crypto';
import { config } from '../config';

/**
 * Derives a consistent 32-byte key from the configured encryption key.
 */
function getDerivedKey(): Buffer {
  return crypto.createHash('sha256').update(config.encryptionKey).digest();
}

/**
 * Encrypts a string using AES-256-GCM.
 * Output format: <hex_iv>:<hex_auth_tag>:<hex_ciphertext>
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return '';
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12); // Recommended 12 bytes for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a string encrypted with AES-256-GCM.
 */
export function decrypt(encryptedPayload: string): string {
  if (!encryptedPayload) return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getDerivedKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
