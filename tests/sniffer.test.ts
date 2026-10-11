import test from 'node:test';
import assert from 'node:assert/strict';
import { SnifferService } from '../apps/api/dist/services/sniffer.service.js';

test('SnifferService - correctly decodes packed JavaScript and extracts m3u8', () => {
  const sniffer = new SnifferService();

  // Test Dean Edwards unpacker simulation
  const packedSample = `eval(function(p,a,c,k,e,d){return p}('var stream = "https://live.testcdn.com/bein1/index.m3u8";',6,6,'var|stream|https|live|testcdn|com'.split('|')))`;
  const unpacked = sniffer.unpackDeanEdwards(packedSample);

  assert.ok(unpacked.includes('https://live.testcdn.com/bein1/index.m3u8'));
});

test('SnifferService - parseM3u extracts valid channel metadata', () => {
  const sniffer = new SnifferService();

  const m3uSample = `#EXTM3U
#EXTINF:-1 tvg-logo="https://cdn.example.com/bein1.png",beIN Sports 1 HD
https://cdn.example.com/bein1.m3u8
#EXTINF:-1 tvg-logo="https://cdn.example.com/ssc1.png",SSC 1 Extra
https://cdn.example.com/ssc1.m3u8
`;

  const parsed = (sniffer as any).parseM3u(m3uSample);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'beIN Sports 1 HD');
  assert.equal(parsed[0].url, 'https://cdn.example.com/bein1.m3u8');
  assert.equal(parsed[0].logo, 'https://cdn.example.com/bein1.png');
  assert.equal(parsed[1].name, 'SSC 1 Extra');
});
