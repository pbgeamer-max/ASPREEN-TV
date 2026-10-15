const { execSync } = require('child_process');
const path = require('path');

console.log('================================================================');
console.log('  Aspreen TV — Automated Test Suite Runner');
console.log('================================================================\n');

const testFiles = [
  'tests/m3u-parser.test.ts',
  'tests/ssrf-security.test.ts',
  'tests/token-security.test.ts',
  'tests/encryption.test.ts',
  'tests/ffmpeg-builder.test.ts',
  'tests/transcoding-e2e.test.ts',
  'tests/api-integration.test.ts',
];

const cmd = `node --experimental-strip-types --test ${testFiles.join(' ')}`;

try {
  execSync(cmd, { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
  console.log('\n================================================================');
  console.log('  All tests completed successfully!');
  console.log('================================================================\n');
} catch (err) {
  console.error('\nTest suite execution failed.');
  process.exit(1);
}
