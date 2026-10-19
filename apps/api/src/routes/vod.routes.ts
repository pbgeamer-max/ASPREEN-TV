import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as http from 'http';
import * as https from 'https';
import { vodService } from '../services/vod.service';

export async function vodRoutes(server: FastifyInstance) {
  /**
   * Helper to determine base URL of the incoming request
   */
  function getBaseUrl(request: FastifyRequest): string {
    const proto = (request.headers['x-forwarded-proto'] as string) || 'https';
    const host = (request.headers['x-forwarded-host'] as string) || request.headers.host || '127.0.0.1:3001';
    return `${proto}://${host}`;
  }

  /**
   * GET /api/app/vod/all (or /api/app/vod/catalog)
   * The All-In-One Unified VOD API
   * Returns movies, series, all seasons & episodes, overviews, and direct playback links
   * completely stripped of all 3isk/قصة عشق branding!
   */
  const handleUnifiedCatalog = async (request: FastifyRequest<{
    Querystring: { page?: string; limit?: string; search?: string; filter?: string; type?: string }
  }>, reply: FastifyReply) => {
    const page = parseInt(request.query.page || '1', 10);
    const limit = parseInt(request.query.limit || '24', 10);
    const { search, filter, type } = request.query;
    const baseUrl = getBaseUrl(request);

    const data = await vodService.getUnifiedCatalog({
      page,
      limit,
      search,
      filter,
      type,
      baseUrl
    });

    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(data);
  };

  server.get('/all', handleUnifiedCatalog);
  server.get('/catalog', handleUnifiedCatalog);

  /**
   * GET /api/app/vod/series
   * List all Turkish series with pagination, search, and category filters
   */
  server.get('/series', async (request: FastifyRequest<{
    Querystring: { page?: string; limit?: string; search?: string; filter?: string }
  }>, reply: FastifyReply) => {
    const page = parseInt(request.query.page || '1', 10);
    const limit = parseInt(request.query.limit || '24', 10);
    const { search, filter } = request.query;

    const data = vodService.getSeries({ page, limit, search, filter });
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(data);
  });

  /**
   * GET /api/app/vod/series/:id
   * Get full details of a Turkish series, including all seasons and episodes
   */
  server.get('/series/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const seriesId = request.params.id;
    const detail = await vodService.getSeriesDetail(seriesId);

    reply.header('Access-Control-Allow-Origin', '*');
    if (!detail) {
      return reply.status(404).send({ success: false, error: 'Series not found' });
    }
    return reply.send({ success: true, series: detail });
  });

  /**
   * GET /api/app/vod/movies
   * List all Turkish movies with pagination, search, and category filters
   */
  server.get('/movies', async (request: FastifyRequest<{
    Querystring: { page?: string; limit?: string; search?: string; filter?: string }
  }>, reply: FastifyReply) => {
    const page = parseInt(request.query.page || '1', 10);
    const limit = parseInt(request.query.limit || '24', 10);
    const { search, filter } = request.query;

    const data = vodService.getMovies({ page, limit, search, filter });
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(data);
  });

  /**
   * GET /api/app/vod/resolve
   * Resolve any 3isk episode or movie URL to direct HLS m3u8 and clean embed URLs
   */
  server.get('/resolve', async (request: FastifyRequest<{
    Querystring: { url?: string; id?: string }
  }>, reply: FastifyReply) => {
    const target = request.query.url || request.query.id;
    if (!target) {
      return reply.status(400).send({ success: false, error: 'Missing url or id parameter' });
    }

    const baseUrl = getBaseUrl(request);
    const resolved = await vodService.resolveStream(target, baseUrl);

    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(resolved);
  });

  /**
   * GET /api/app/vod/stream
   * Universal CORS streaming proxy for HLS VOD (.m3u8 playlists & .ts chunks)
   * Supports both direct ?url=... and on-demand ?id=... (resolving fresh streams on the fly)
   */
  server.get('/stream', async (request: FastifyRequest<{
    Querystring: { url?: string; id?: string }
  }>, reply: FastifyReply) => {
    let rawUrl = request.query.url;
    const baseUrl = getBaseUrl(request);

    // If passed by id, resolve fresh stream on the fly!
    if (!rawUrl && request.query.id) {
      const resolved = await vodService.resolveStream(request.query.id, baseUrl);
      if (resolved.hlsUrl) {
        rawUrl = resolved.hlsUrl;
      } else {
        return reply.status(404).send('Stream could not be resolved');
      }
    }

    if (!rawUrl) {
      return reply.status(400).send('Missing url or id parameter');
    }

    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    reply.header('Access-Control-Allow-Headers', '*');

    return new Promise<void>((resolve) => {
      try {
        const parsedUrl = new URL(rawUrl);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const isM3u8 = parsedUrl.pathname.endsWith('.m3u8') || rawUrl.includes('.m3u8');

        const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
        const pathSegments = parsedUrl.pathname.split('/');
        pathSegments.pop();
        const currentDir = `${origin}${pathSegments.join('/')}/`;

        let referer = 'https://miravd.com/';
        if (rawUrl.includes('vidmoly')) {
          referer = 'https://vidmoly.to/';
        } else if (rawUrl.includes('ukrcdn') || rawUrl.includes('grzcdn') || rawUrl.includes('miravd')) {
          referer = 'https://miravd.com/';
        } else if (rawUrl.includes('mwdy')) {
          referer = 'https://mwdy.cc/';
        } else if (rawUrl.includes('upstream')) {
          referer = 'https://upstream.to/';
        } else {
          referer = origin + '/';
        }

        const proxyReq = client.request(rawUrl, {
          method: request.method,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
            'Referer': referer,
            'Origin': referer.replace(/\/$/, ''),
          },
          rejectUnauthorized: false,
        }, (proxyRes) => {
          // Follow HTTP redirect if any
          if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            reply.redirect(proxyRes.headers.location);
            resolve();
            return;
          }

          if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
            reply.status(proxyRes.statusCode).send(`Upstream CDN error: ${proxyRes.statusCode}`);
            resolve();
            return;
          }

          if (!isM3u8) {
            // Binary .ts chunk, mp4, or encryption.key
            if (!reply.raw.headersSent) {
              reply.raw.writeHead(proxyRes.statusCode || 200, {
                'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Cache-Control': 'public, max-age=86400',
                ...(proxyRes.headers['content-length'] ? { 'Content-Length': proxyRes.headers['content-length'] } : {})
              });
            }
            proxyRes.pipe(reply.raw);
            proxyRes.on('end', () => resolve());
            return;
          }

          // HLS playlist text: rewrite relative or sub URLs through proxy
          let playlistText = '';
          proxyRes.setEncoding('utf-8');
          proxyRes.on('data', chunk => playlistText += chunk);
          proxyRes.on('end', () => {
            const toProxyUrl = (target: string): string => {
              const trimmedTarget = target.trim();
              let absoluteTarget = trimmedTarget;
              if (trimmedTarget.startsWith('http://') || trimmedTarget.startsWith('https://')) {
                absoluteTarget = trimmedTarget;
              } else if (trimmedTarget.startsWith('/')) {
                absoluteTarget = `${origin}${trimmedTarget}`;
              } else {
                absoluteTarget = `${currentDir}${trimmedTarget}`;
              }
              return `${baseUrl}/api/app/vod/stream?url=${encodeURIComponent(absoluteTarget)}`;
            };

            const lines = playlistText.split('\n');
            const rewrittenLines = lines.map(line => {
              const trimmed = line.trim();
              if (!trimmed) {
                return line;
              }

              // 1. Rewrite encryption keys, init maps, alternate media URIs
              if (
                trimmed.startsWith('#EXT-X-KEY:') ||
                trimmed.startsWith('#EXT-X-MAP:') ||
                trimmed.startsWith('#EXT-X-MEDIA:') ||
                trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF:')
              ) {
                return line.replace(/URI=["']([^"']+)["']/g, (_m, uri) => {
                  return `URI="${toProxyUrl(uri)}"`;
                });
              }

              // 2. Ignore other HLS directives/comments
              if (trimmed.startsWith('#')) {
                return line;
              }

              // 3. Normal segment or sub-playlist URL
              return toProxyUrl(trimmed);
            });

            reply.header('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
            reply.header('Access-Control-Allow-Origin', '*');
            reply.header('Cache-Control', 'no-cache, no-store');
            reply.status(200);
            reply.send(rewrittenLines.join('\n'));
            resolve();
          });
        });

        proxyReq.on('error', (err) => {
          if (!reply.raw.headersSent) {
            reply.status(502).send(`Stream proxy error: ${err.message}`);
          }
          resolve();
        });

        proxyReq.end();
      } catch (e: any) {
        reply.status(500).send(`Proxy exception: ${e.message}`);
        resolve();
      }
    });
  });

  /**
   * GET /api/app/vod/player
   * Clean, ad-free, standalone responsive HTML5 video player for embedding in other websites
   */
  server.get('/player', async (request: FastifyRequest<{
    Querystring: { url?: string; id?: string; title?: string }
  }>, reply: FastifyReply) => {
    const target = request.query.url || request.query.id;
    if (!target) {
      return reply.status(400).send('Missing url or id parameter');
    }

    const baseUrl = getBaseUrl(request);
    const resolved = await vodService.resolveStream(target, baseUrl);

    const streamSrc = resolved.streamProxyUrl || resolved.hlsUrl || '';
    const embedFallback = resolved.embedUrl || '';
    const playerTitle = resolved.title || request.query.title || 'مشاهدة الفيديو';

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${playerTitle} - ASPREEN TV</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/video.js/8.10.0/video-js.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    #playerContainer { width: 100%; height: 100%; position: relative; display: flex; align-items: center; justify-content: center; }
    .video-js { width: 100% !important; height: 100% !important; }
    .video-js .vjs-big-play-button {
      top: 50% !important; left: 50% !important; transform: translate(-50%, -50%);
      background-color: rgba(168, 85, 247, 0.85); border: none; border-radius: 50%;
      width: 70px; height: 70px; line-height: 70px; font-size: 38px;
    }
    .video-js .vjs-big-play-button:hover { background-color: #a855f7; }
    .vjs-control-bar { background: linear-gradient(transparent, rgba(0,0,0,0.9)) !important; }
    #fallbackIframe { width: 100%; height: 100%; border: none; }
    .watermark {
      position: absolute; top: 16px; right: 16px; z-index: 10;
      color: rgba(255,255,255,0.7); font-weight: bold; font-size: 14px;
      pointer-events: none; text-shadow: 0 2px 4px rgba(0,0,0,0.8);
      display: flex; align-items: center; gap: 6px;
    }
    .watermark span { color: #a855f7; }
  </style>
</head>
<body>
  <div id="playerContainer">
    <div class="watermark">ASPREEN <span>TV</span></div>
    ${streamSrc ? `
      <video id="aspreenVodPlayer" class="video-js vjs-default-skin vjs-big-play-centered" controls autoplay playsinline preload="auto">
        <source src="${streamSrc}" type="application/x-mpegURL">
      </video>
    ` : `
      <iframe id="fallbackIframe" src="${embedFallback}" allowfullscreen allow="autoplay; fullscreen"></iframe>
    `}
  </div>

  ${streamSrc ? `
  <script src="https://cdnjs.cloudflare.com/ajax/libs/video.js/8.10.0/video.min.js"></script>
  <script>
    const player = videojs('aspreenVodPlayer', {
      fluid: false,
      autoplay: true,
      controls: true,
      html5: {
        vhs: {
          overrideNative: true,
          enableLowInitialPlaylist: true
        }
      }
    });

    player.on('error', function() {
      console.warn('HLS direct playback error, falling back to clean embed iframe...');
      const fallbackUrl = "${embedFallback}";
      if (fallbackUrl) {
        document.getElementById('playerContainer').innerHTML = '<div class="watermark">ASPREEN <span>TV</span></div><iframe id="fallbackIframe" src="' + fallbackUrl + '" allowfullscreen allow="autoplay; fullscreen"></iframe>';
      }
    });
  </script>
  ` : ''}
</body>
</html>`;

    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Access-Control-Allow-Origin', '*');
    return reply.send(html);
  });

  /**
   * POST /api/app/vod/sync
   * Admin trigger to re-harvest catalog from 3isk
   */
  server.post('/sync', async (_request, reply: FastifyReply) => {
    vodService.syncCatalogInBackground();
    return reply.send({ success: true, message: 'VOD harvest started in background' });
  });
}
