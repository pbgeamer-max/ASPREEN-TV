import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateStreamToken,
  hashStreamToken,
  verifyStreamToken,
  buildPlaybackUrl,
} from '../apps/api/dist/security/token.js';

test('Token Security - Generates high-entropy 64-character hex tokens', () => {
  const token1 = generateStreamToken();
  const token2 = generateStreamToken();

  assert.equal(token1.length, 64);
  assert.equal(token2.length, 64);
  assert.notEqual(token1, token2);
  assert.match(token1, /^[a-f0-9]{64}$/);
});

test('Token Security - Produces consistent SHA-256 HMAC hash', () => {
  const rawToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const hash1 = hashStreamToken(rawToken);
  const hash2 = hashStreamToken(rawToken);

  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
  assert.match(hash1, /^[a-f0-9]{64}$/);
});

test('Token Security - Verifies correct tokens and rejects altered tokens in constant time', () => {
  const rawToken = generateStreamToken();
  const storedHash = hashStreamToken(rawToken);

  assert.equal(verifyStreamToken(rawToken, storedHash), true);

  // Altered character
  const tamperedToken = rawToken.slice(0, -1) + (rawToken.endsWith('a') ? 'b' : 'a');
  assert.equal(verifyStreamToken(tamperedToken, storedHash), false);
});

test('Token Security - Correctly builds full bearer playback URL', () => {
  const baseUrl = 'https://stream.aspreen.tv';
  const outputId = 'stream_ch1_abc123';
  const token = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

  const playbackUrl = buildPlaybackUrl(baseUrl, outputId, token);
  assert.equal(
    playbackUrl,
    `https://stream.aspreen.tv/hls/stream_ch1_abc123/${token}/index.m3u8`
  );
});
