import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { generateSyntheticStream } from '../scripts/generate-test-stream.js';
import { buildFfmpegArgs } from '../packages/shared/dist/presets.js';

test('Transcoding Engine - End-to-End Real FFmpeg HLS Generation with Synthetic Stream', async () => {
  // 1. Generate synthetic source video
  const syntheticVideoPath = generateSyntheticStream();
  assert.ok(fs.existsSync(syntheticVideoPath));

  // 2. Prepare test output directory
  const testOutputDir = path.resolve(process.cwd(), 'data/test-hls-output');
  fs.rmSync(testOutputDir, { recursive: true, force: true });
  fs.mkdirSync(testOutputDir, { recursive: true });

  // 3. Build arguments for FFmpeg
  const args = buildFfmpegArgs({
    inputUrl: syntheticVideoPath,
    presetId: 'COPY',
    segmentDuration: 2,
    playlistWindow: 3,
    outputDir: testOutputDir,
  });

  // 4. Run FFmpeg process
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { windowsHide: true });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });

  // 5. Verify index.m3u8 is created
  const playlistPath = path.resolve(testOutputDir, 'index.m3u8');
  assert.ok(fs.existsSync(playlistPath), 'index.m3u8 must exist');

  const playlistContent = fs.readFileSync(playlistPath, 'utf8');
  assert.ok(playlistContent.includes('#EXTM3U'), 'Playlist must contain #EXTM3U header');
  assert.ok(playlistContent.includes('#EXT-X-TARGETDURATION'), 'Playlist must define target duration');
  assert.ok(playlistContent.includes('.ts'), 'Playlist must reference .ts media segments');

  // 6. Verify segment files exist on disk
  const files = fs.readdirSync(testOutputDir);
  const segments = files.filter((f) => f.endsWith('.ts'));
  assert.ok(segments.length >= 1, 'At least 1 .ts media segment must be generated');

  const firstSegmentSize = fs.statSync(path.resolve(testOutputDir, segments[0])).size;
  assert.ok(firstSegmentSize > 1000, 'Segment file size must be non-empty valid MPEG-TS');

  // Cleanup
  fs.rmSync(testOutputDir, { recursive: true, force: true });
});
