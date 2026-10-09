/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const apiBase = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3001';
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
        destination: `${apiBase}/live/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
