import test from 'node:test';
import assert from 'node:assert/strict';
import { parseM3UPlaylist } from '../packages/shared/dist/parser/m3u.js';

test('M3U Parser - Parses valid #EXTINF channel entries and attributes', () => {
  const sampleM3U = `#EXTM3U
#EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN US" tvg-logo="https://example.com/cnn.png" group-title="News",CNN News Live
https://stream.example.com/live/cnn.m3u8
#EXTINF:-1 tvg-id="espn.us" tvg-name="ESPN HD" group-title="Sports",ESPN 1
https://stream.example.com/live/espn.m3u8`;

  const result = parseM3UPlaylist(sampleM3U);

  assert.equal(result.isChannelCollection, true);
  assert.equal(result.channels.length, 2);
  assert.equal(result.channels[0].displayName, 'CNN News Live');
  assert.equal(result.channels[0].tvgId, 'cnn.us');
  assert.equal(result.channels[0].tvgLogo, 'https://example.com/cnn.png');
  assert.equal(result.channels[0].groupTitle, 'News');
  assert.equal(result.channels[0].url, 'https://stream.example.com/live/cnn.m3u8');

  assert.equal(result.channels[1].displayName, 'ESPN 1');
  assert.equal(result.channels[1].groupTitle, 'Sports');
});

test('M3U Parser - Strips UTF-8 BOM properly', () => {
  const withBom = `\uFEFF#EXTM3U\n#EXTINF:-1,Channel 1\nhttps://stream.example.com/live/ch1.m3u8`;
  const result = parseM3UPlaylist(withBom);

  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].displayName, 'Channel 1');
});

test('M3U Parser - Detects HLS master and media playlists vs channel collections', () => {
  const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=720x480
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1280x720
mid.m3u8`;

  const masterResult = parseM3UPlaylist(masterPlaylist);
  assert.equal(masterResult.isMasterPlaylist, true);

  const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:6.0,
segment0.ts`;

  const mediaResult = parseM3UPlaylist(mediaPlaylist);
  assert.equal(masterResult.isMasterPlaylist, true);
  assert.equal(mediaResult.isMediaPlaylist, true);
});

test('M3U Parser - Enforces maxEntries limit correctly', () => {
  let content = '#EXTM3U\n';
  for (let i = 1; i <= 20; i++) {
    content += `#EXTINF:-1,Channel ${i}\nhttps://stream.example.com/ch${i}.m3u8\n`;
  }

  const result = parseM3UPlaylist(content, { maxEntries: 5 });
  assert.equal(result.channels.length, 5);
});
