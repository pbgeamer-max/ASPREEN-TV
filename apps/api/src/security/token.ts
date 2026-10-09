import * as crypto from 'crypto';
import { config } from '../config';

/**
 * Generates a cryptographically strong random bearer token for stream playback.
 */
export function generateStreamToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes a secure SHA-256 hash of a stream playback token.
 * Only this hash is stored in Firestore; raw tokens are never persisted.
 */
export function hashStreamToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', config.streamTokenSecret)
    .update(rawToken)
    .digest('hex');
}

/**
 * Verifies if a raw token matches a stored token hash in constant time.
 */
export function verifyStreamToken(rawToken: string, storedHash: string): boolean {
  const calculatedHash = hashStreamToken(rawToken);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculatedHash, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Constructs the full bearer HLS playback URL for an authorized client.
 */
export function buildPlaybackUrl(publicBaseUrl: string, publicOutputId: string, rawToken: string): string {
  const normalizedBase = publicBaseUrl.replace(/\/$/, '');
  return `${normalizedBase}/hls/${publicOutputId}/${rawToken}/index.m3u8`;
}

/**
 * Constructs the full bearer MPEG-TS playback URL for an authorized client.
 */
export function buildTsPlaybackUrl(publicBaseUrl: string, publicOutputId: string, rawToken: string): string {
  const normalizedBase = publicBaseUrl.replace(/\/$/, '');
  return `${normalizedBase}/live/${publicOutputId}/${rawToken}.ts`;
}
