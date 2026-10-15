/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const apiBase = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3001';
    const streamProxyBase = process.env.STREAM_PROXY_URL || 'http://127.0.0.1:8088';
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
      {
        source: '/hls/:path*',
        destination: `${apiBase}/hls/:path*`,
      },
      {
        source: '/live/:path*',
        destination: `${streamProxyBase}/live/:path*`,
      },
      {
        source: '/ts',
        destination: `${streamProxyBase}/ts`,
      },
      {
        source: '/playlist.m3u',
        destination: `${streamProxyBase}/playlist.m3u`,
      },
    ];
  },
};

module.exports = nextConfig;

