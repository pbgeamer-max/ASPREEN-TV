import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFfmpegArgs } from '../packages/shared/dist/presets.js';

test('FFmpeg Builder - Builds argument array for Compatible Stream Copy (COPY)', () => {
  const args = buildFfmpegArgs({
    inputUrl: 'https://source.example.com/stream.m3u8',
    presetId: 'COPY',
    segmentDuration: 4,
    playlistWindow: 5,
    outputDir: '/var/www/aspreen/hls/ch_test_1',
  });

  assert.ok(args.includes('-i'));
  assert.ok(args.includes('https://source.example.com/stream.m3u8'));
  assert.ok(args.includes('-c:v'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
  assert.ok(args.includes('-c:a'));
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');

  // Protocol whitelist must be present for security
  assert.ok(args.includes('-protocol_whitelist'));

  // HLS options
  assert.ok(args.includes('-hls_time'));
  assert.equal(args[args.indexOf('-hls_time') + 1], '4');
  assert.ok(args.includes('-hls_list_size'));
  assert.equal(args[args.indexOf('-hls_list_size') + 1], '5');
});

test('FFmpeg Builder - Builds argument array for 720p transcoding preset', () => {
  const args = buildFfmpegArgs({
    inputUrl: 'https://source.example.com/stream.m3u8',
    presetId: '720P',
    segmentDuration: 6,
    playlistWindow: 6,
    outputDir: '/var/www/aspreen/hls/ch_test_720',
  });

  assert.ok(args.includes('-c:v'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.ok(args.includes('-vf'));
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=-2:720');
  assert.ok(args.includes('-b:v'));
  assert.equal(args[args.indexOf('-b:v') + 1], '2500k');
  assert.ok(args.includes('-c:a'));
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
});

test('FFmpeg Builder - Builds argument array for 1080p transcoding preset', () => {
  const args = buildFfmpegArgs({
    inputUrl: 'https://source.example.com/stream.m3u8',
    presetId: '1080P',
    segmentDuration: 4,
    playlistWindow: 5,
    outputDir: '/var/www/aspreen/hls/ch_test_1080',
  });

  assert.ok(args.includes('-vf'));
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=-2:1080');
  assert.ok(args.includes('-b:v'));
  assert.equal(args[args.indexOf('-b:v') + 1], '5000k');
  assert.ok(args.includes('-b:a'));
  assert.equal(args[args.indexOf('-b:a') + 1], '192k');
});
