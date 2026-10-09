import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  validateUrlSsrf,
} from '../packages/shared/dist/security/ssrf.js';

test('SSRF Protection - Blocks IPv4 Loopback Addresses (127.0.0.0/8)', () => {
  assert.equal(isPrivateOrReservedIPv4('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIPv4('127.100.200.1'), true);
});

test('SSRF Protection - Blocks RFC 1918 Private IPv4 Ranges', () => {
  // 10.0.0.0/8
  assert.equal(isPrivateOrReservedIPv4('10.0.0.1'), true);
  assert.equal(isPrivateOrReservedIPv4('10.255.255.254'), true);

  // 172.16.0.0/12
  assert.equal(isPrivateOrReservedIPv4('172.16.0.1'), true);
  assert.equal(isPrivateOrReservedIPv4('172.31.255.255'), true);
  assert.equal(isPrivateOrReservedIPv4('172.32.0.1'), false); // Public

  // 192.168.0.0/16
  assert.equal(isPrivateOrReservedIPv4('192.168.1.1'), true);
  assert.equal(isPrivateOrReservedIPv4('192.168.100.254'), true);
});

test('SSRF Protection - Blocks Cloud Metadata (169.254.169.254 & Link-Local)', () => {
  assert.equal(isPrivateOrReservedIPv4('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIPv4('169.254.1.1'), true);
});

test('SSRF Protection - Allows Public Internet IPv4 Addresses', () => {
  assert.equal(isPrivateOrReservedIPv4('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIPv4('1.1.1.1'), false);
  assert.equal(isPrivateOrReservedIPv4('93.184.216.34'), false);
});

test('SSRF Protection - Blocks IPv6 Loopback and Unique Local', () => {
  assert.equal(isPrivateOrReservedIPv6('::1'), true);
  assert.equal(isPrivateOrReservedIPv6('fc00::1'), true);
  assert.equal(isPrivateOrReservedIPv6('fe80::1'), true);
  assert.equal(isPrivateOrReservedIPv6('::ffff:192.168.1.1'), true);
});

test('SSRF Protection - Validates URL scheme and host safely', async () => {
  // Disallowed schemes
  const fileRes = await validateUrlSsrf('file:///etc/passwd');
  assert.equal(fileRes.isValid, false);
  assert.equal(fileRes.errorCode, 'DISALLOWED_PROTOCOL');

  const gopherRes = await validateUrlSsrf('gopher://127.0.0.1:70');
  assert.equal(gopherRes.isValid, false);

  // Blocked hosts
  const localhostRes = await validateUrlSsrf('http://localhost:8080/stream.m3u8');
  assert.equal(localhostRes.isValid, false);
  assert.equal(localhostRes.errorCode, 'BLOCKED_HOST');

  const metaRes = await validateUrlSsrf('http://metadata.google.internal/computeMetadata/v1/');
  assert.equal(metaRes.isValid, false);

  // Direct private IP in URL
  const ipRes = await validateUrlSsrf('http://192.168.1.50:8000/live.m3u8');
  assert.equal(ipRes.isValid, false);
  assert.equal(ipRes.errorCode, 'PRIVATE_IP');
});
