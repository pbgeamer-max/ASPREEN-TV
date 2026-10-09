const { spawn } = require('child_process');
const path = require('path');

console.log('================================================================');
console.log('  Aspreen TV — Local Development Environment');
console.log('================================================================\n');

// Start API server
const apiProc = spawn('node', ['apps/api/dist/index.js'], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    PORT: '3001',
    NODE_ENV: 'development',
  },
});

// Start Web frontend
const webProc = spawn('npx', ['next', 'dev', '-p', '3000'], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '../apps/web'),
  shell: true,
  env: {
    ...process.env,
    NEXT_PUBLIC_API_URL: 'http://localhost:3001/api',
  },
});

function cleanup() {
  console.log('\nShutting down Aspreen TV services...');
  apiProc.kill();
  webProc.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
