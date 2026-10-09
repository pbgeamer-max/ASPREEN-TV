const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Generates an authorized synthetic video file for end-to-end transcoding tests.
 * Uses FFmpeg lavfi virtual devices (color bars + audio tone) so no external media is required.
 */
function generateSyntheticStream() {
  const outputDir = path.resolve(__dirname, '../data/test-media');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputFile = path.resolve(outputDir, 'synthetic_test_stream.mp4');

  if (fs.existsSync(outputFile)) {
    console.log(`[Aspreen TV Test] Synthetic stream already exists at: ${outputFile}`);
    return outputFile;
  }

  console.log('[Aspreen TV Test] Generating synthetic test stream using FFmpeg...');
  const cmd = `ffmpeg -y -f lavfi -i testsrc=duration=15:size=1280x720:rate=30 -f lavfi -i sine=frequency=1000:duration=15 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 128k "${outputFile}"`;

  execSync(cmd, { stdio: 'inherit' });
  console.log(`[Aspreen TV Test] Synthetic test stream successfully created: ${outputFile}`);
  return outputFile;
}

if (require.main === module) {
  generateSyntheticStream();
}

module.exports = { generateSyntheticStream };
