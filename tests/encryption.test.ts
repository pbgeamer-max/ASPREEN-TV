import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../apps/api/dist/security/encryption.js';

test('Encryption - Correctly encrypts and decrypts sensitive string payloads', () => {
  const sensitiveSource = 'https://secret-provider.org/live/auth_token=9988776655/master.m3u8';
  const ciphertext = encrypt(sensitiveSource);

  assert.notEqual(ciphertext, sensitiveSource);
  assert.match(ciphertext, /^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/); // iv:authTag:ciphertext

  const decrypted = decrypt(ciphertext);
  assert.equal(decrypted, sensitiveSource);
});

test('Encryption - Uses unique IV for every encryption call (semantic security)', () => {
  const plaintext = 'https://stream.example.com/live.m3u8';
  const ct1 = encrypt(plaintext);
  const ct2 = encrypt(plaintext);

  assert.notEqual(ct1, ct2); // Different IVs produce different ciphertexts
  assert.equal(decrypt(ct1), plaintext);
  assert.equal(decrypt(ct2), plaintext);
});

test('Encryption - Throws error when ciphertext or auth tag is tampered with', () => {
  const plaintext = 'https://stream.example.com/live.m3u8';
  const ciphertext = encrypt(plaintext);
  const parts = ciphertext.split(':');

  // Corrupt the ciphertext body
  const corruptedCiphertext = `${parts[0]}:${parts[1]}:deadbeef${parts[2].substring(8)}`;

  assert.throws(() => {
    decrypt(corruptedCiphertext);
  });
});
