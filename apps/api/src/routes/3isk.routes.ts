import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { settingsRepository } from '../repositories/settings.repository';

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 20, timeout: 30000 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 20, timeout: 30000 });

// In-memory cache for resolved stream URLs (TTL: 2 hours)
const streamCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Unpacks Dean Edwards packed JavaScript code (used by JWPlayer on MiraVD/GRZCDN)
 */
function unpackDeanEdwards(packed: string): string | null {
  const match = packed.match(/}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) return null;
  let p = match[1];
  const a = parseInt(match[2], 10);
  let c = parseInt(match[3], 10);
  const k = match[4].split('|');
  const e = (d: number): string => {
    return (d < a ? '' : e(Math.floor(d / a))) + ((d = d % a) > 35 ? String.fromCharCode(d + 29) : d.toString(36));
  };
  while (c--) {
    if (k[c]) {
      p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
    }
  }
  return p;
}

/**
 * Universal multi-host resolver: converts any 3isk watch page to direct high-speed HLS master.m3u8
 */
async function resolve3iskStream(watchPageUrl: string): Promise<string> {
  const cached = streamCache.get(watchPageUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  // Step 1: Fetch watch page
  const pageRes = await fetch(watchPageUrl, {
    headers: { 'User-Agent': ua, 'Referer': 'https://3iskk.xyz/' },
  });
  const pageHtml = await pageRes.text();

  // Find form with news token
  const allForms = [...pageHtml.matchAll(/<form[^>]+action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/gi)];
  let formAction = '';
  let newsVal = '';

  for (const f of allForms) {
    const action = f[1];
    const html = f[2];
    const nMatch = html.match(/name="news"\s+value="([^"]+)"/i) || html.match(/value="([^"]+)"\s+name="news"/i);
    if (nMatch) {
      formAction = action;
      newsVal = nMatch[1];
      break;
    }
  }

  if (!newsVal) {
    const rawNewsMatch = pageHtml.match(/name="news"\s+value="([^"]+)"/i) || pageHtml.match(/value="([^"]+)"\s+name="news"/i);
    if (rawNewsMatch) {
      newsVal = rawNewsMatch[1];
      const actionMatch = pageHtml.match(/action="(https?:\/\/[^"]*3isk[^"]*\.php)"/i);
      formAction = actionMatch ? actionMatch[1] : 'https://aa.3isk.icu/3isk363525.php';
    }
  }

  if (!newsVal) {
    throw new Error('Watch token not found on 3isk page');
  }

  // Step 2: Gate 1
  const body1 = new URLSearchParams();
  body1.append('news', newsVal);
  body1.append('u', '');
  body1.append('submit', 'submit');

  const gate1Res = await fetch(formAction, {
    method: 'POST',
    headers: {
      'User-Agent': ua,
      'Referer': watchPageUrl,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body1.toString(),
  });
  const gate1Html = await gate1Res.text();

  const nextUrlMatch = gate1Html.match(/var\s+myUrl\s*=\s*"([^"]+)"/i);
  const nextInputMatch = gate1Html.match(/myInput\.value\s*=\s*"([^"]+)"/i);
  if (!nextUrlMatch || !nextInputMatch) {
    throw new Error('Failed to extract gate 2 parameters');
  }

  // Step 3: Gate 2
  const body2 = new URLSearchParams();
  body2.append('news', nextInputMatch[1]);
  body2.append('inputVal', nextInputMatch[1]);
  body2.append('submit', 'submit');

  const gate2Res = await fetch(nextUrlMatch[1], {
    method: 'POST',
    headers: {
      'User-Agent': ua,
      'Referer': formAction,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body2.toString(),
  });
  const gate2Html = await gate2Res.text();

  const iframeMatch = gate2Html.match(/<iframe[^>]+src="([^"]+)"/i);
  if (!iframeMatch) {
    throw new Error('Embed iframe not found in gate 2');
  }

  // Step 4: Embed -> player iframe
  const embedRes = await fetch(iframeMatch[1], {
    headers: { 'User-Agent': ua, 'Referer': nextUrlMatch[1] },
  });
  const embedHtml = await embedRes.text();

  const playerIframeMatch = embedHtml.match(/<iframe[^>]+src="([^"]+)"/i);
  if (!playerIframeMatch) {
    throw new Error('Player iframe not found in embed');
  }

  const cdnPlayerUrl = playerIframeMatch[1];
  let directStreamUrl = '';

  // Host 1: UkrCDN / S4 CDN
  if (cdnPlayerUrl.includes('ukrcdn')) {
    try {
      const cdnRes = await fetch(cdnPlayerUrl, {
        headers: { 'User-Agent': ua, 'Referer': 'https://3iskk.xyz/' },
      });
      const cdnHtml = await cdnRes.text();
      const playbackMatch = cdnHtml.match(/fetch\("([^"]+playback[^"]+)"/i);
      if (playbackMatch) {
        const playbackUrl = playbackMatch[1].replace(/\\/g, '');
        const playRes = await fetch(playbackUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': ua,
            'Referer': cdnPlayerUrl,
          },
        });
        const playJson: any = await playRes.json();
        if (playJson && playJson.url) {
          directStreamUrl = playJson.url;
        }
      }
    } catch {}
  }

  // Host 2: MiraVD / GRZCDN / JWPlayer Dean Edwards packed player
  if (!directStreamUrl) {
    try {
      const miraRes = await fetch(cdnPlayerUrl, {
        headers: { 'User-Agent': ua, 'Referer': 'https://3iskk.xyz/' },
      });
      const miraHtml = await miraRes.text();

      const packedMatch = miraHtml.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
      if (packedMatch) {
        const unpacked = unpackDeanEdwards(packedMatch[0]);
        if (unpacked) {
          const m3u8Match = unpacked.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i) ||
                            unpacked.match(/file\s*:\s*["']([^"']+)["']/i);
          if (m3u8Match) {
            directStreamUrl = m3u8Match[1] || m3u8Match[0];
          }
        }
      }

      if (!directStreamUrl) {
        const directM3u8 = miraHtml.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i) ||
                           miraHtml.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
        if (directM3u8) {
          directStreamUrl = directM3u8[0];
        }
      }
    } catch {}
  }

  // Host 3: Generic fallback
  if (!directStreamUrl) {
    try {
      const genRes = await fetch(cdnPlayerUrl, {
        headers: { 'User-Agent': ua, 'Referer': 'https://3iskk.xyz/' },
      });
      const genHtml = await genRes.text();
      const anyM3u8 = genHtml.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i) ||
                      genHtml.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
      if (anyM3u8) {
        directStreamUrl = anyM3u8[0];
      }
    } catch {}
  }

  if (!directStreamUrl) {
    throw new Error(`Unable to extract playable stream from player: ${cdnPlayerUrl}`);
  }

  // Cache resolved stream for 20 minutes (aligns with upstream CDN session token duration)
  streamCache.set(watchPageUrl, {
    url: directStreamUrl,
    expiresAt: Date.now() + 20 * 60 * 1000,
  });

  return directStreamUrl;
}

import { threeIskSyncService } from '../services/3isk-sync.service';

export async function iskRoutes(server: FastifyInstance) {
  /**
   * POST /api/app/3isk/sync
   * Manually triggers a sync crawl for latest episodes, movies, and series
   */
  server.post('/sync', async (_request, reply) => {
    try {
      const stats = await threeIskSyncService.syncLatest();
      return {
        success: true,
        message: 'تم فحص قصة عشق وتحديث الأعمال الجديدة بنجاح',
        stats,
      };
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * GET /api/app/3isk/series/:id/episodes
   * Loads full episodes on-demand for any series from A to Z
   */
  server.get('/series/:id/episodes', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = request.params;
    const catalog = threeIskSyncService.getCatalog();
    const s = catalog.series.find((item) => item.id === id);

    if (!s) {
      return reply.status(404).send({ success: false, error: 'Series not found' });
    }

    if (!s.episodes || s.episodes.length === 0) {
      try {
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        const sRes = await fetch(s.seriesUrl, { headers: { 'User-Agent': ua, 'Referer': 'https://3iskk.xyz/' } });
        const sHtml = await sRes.text();
        const epLinks = [...sHtml.matchAll(/<a[^>]*href=['"](https:\/\/3iskk\.xyz\/watch\/episodes\/[^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)];
        const eps: any[] = [];
        for (const ep of epLinks) {
          const epUrl = ep[1];
          const epInner = ep[2].replace(/<[^>]+>/g, '').trim();
          const epNumMatch = epUrl.match(/episode-(\d+)/i) || epInner.match(/(\d+)/);
          const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : (eps.length + 1);
          eps.push({
            episodeNumber: epNum,
            title: `الحلقة ${epNum}`,
            watchUrl: epUrl,
          });
        }
        eps.sort((a, b) => a.episodeNumber - b.episodeNumber);
        s.episodes = eps;
        s.episodes_count = eps.length;
      } catch (err: any) {
        console.warn(`Failed on-demand episodes fetch for ${id}:`, err.message);
      }
    }

    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = 'https://aspreen-tv-production.up.railway.app';
    if (reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }

    reply.header('Access-Control-Allow-Origin', '*');
    return {
      success: true,
      series_id: id,
      title: s.title,
      episodes_count: s.episodes?.length || 0,
      episodes: (s.episodes || []).map((ep: any) => ({
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        watchUrl: ep.watchUrl,
        streamUrl: `${effectiveBaseUrl}/api/app/3isk/video.mp4?url=${encodeURIComponent(ep.watchUrl)}`,
      })),
    };
  });

  /**
   * GET /api/app/3isk/catalog
   * Returns all Turkish series and movies with posters, stories, and streaming links
   */
  server.get('/catalog', async (request: FastifyRequest<{ Querystring: { type?: string; q?: string; category?: string; api_key?: string } }>, reply) => {
    const { type, q, category } = request.query;
    const catalog = threeIskSyncService.getCatalog();

    const settings = await settingsRepository.getSettings();

    // 1. Check if Master API is disabled by admin
    if (settings.masterApiEnabled === false) {
      reply.header('Access-Control-Allow-Origin', '*');
      return reply.status(403).send({
        success: false,
        error: 'API_DISABLED',
        message: 'خدمة الـ API متوقفة حالياً بقرار من إدارة الموقع',
      });
    }

    // 2. Check API Key
    const configuredKey = (settings.masterApiKey || '').trim();
    const incomingKey = (request.query as any).api_key ||
                        request.headers['x-api-key'] ||
                        (request.headers.authorization ? request.headers.authorization.replace(/^Bearer\s+/i, '') : '');

    const referer = (request.headers.referer || '');
    const hasAdminCookie = Boolean(request.cookies && (request.cookies.__session || request.cookies.token));
    const isInternalWeb = hasAdminCookie ||
                          referer.includes('/3isk') ||
                          referer.includes('localhost') ||
                          referer.includes('railway.app') ||
                          request.ip === '127.0.0.1' ||
                          request.ip === '::1' ||
                          request.ip === '::ffff:127.0.0.1';

    if (configuredKey !== '' && !isInternalWeb) {
      if (!incomingKey || incomingKey !== configuredKey) {
        reply.header('Access-Control-Allow-Origin', '*');
        return reply.status(401).send({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'مفتاح الـ API غير صالح أو تم تغييره من لوحة التحكم',
        });
      }
    }

    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }
    if (!effectiveBaseUrl) {
      effectiveBaseUrl = 'https://aspreen-tv-production.up.railway.app';
    }

    const keyParam = incomingKey ? `&api_key=${encodeURIComponent(incomingKey)}` : '';

    // Map series with proxied images and stream endpoints
    let series = (catalog.series || []).map((s) => {
      const proxiedPoster = s.poster ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(s.poster)}` : null;
      const episodes = (s.episodes || []).map((ep: any) => ({
        episode_number: ep.episodeNumber,
        title: ep.title,
        watch_url: ep.watchUrl,
        stream_url: `${effectiveBaseUrl}/api/app/3isk/video.mp4?url=${encodeURIComponent(ep.watchUrl)}${keyParam}`,
        hls_stream_url: `${effectiveBaseUrl}/api/app/3isk/stream?url=${encodeURIComponent(ep.watchUrl)}${keyParam}`,
      }));

      return {
        id: s.id,
        title: s.title,
        type: 'SERIES',
        category: s.category || 'مسلسلات تركية',
        poster: proxiedPoster,
        raw_poster: s.poster || null,
        description: s.description || '',
        episodes_count: episodes.length,
        episodes,
      };
    });

    // Map movies
    let movies = (catalog.movies || []).map((m) => {
      const proxiedPoster = m.poster ? `${effectiveBaseUrl}/api/app/image-proxy?url=${encodeURIComponent(m.poster)}` : null;
      return {
        id: m.id,
        title: m.title,
        type: 'MOVIE',
        category: m.category || 'أفلام تركية',
        poster: proxiedPoster,
        raw_poster: m.poster || null,
        description: m.description || '',
        watch_url: m.watchUrl,
        stream_url: `${effectiveBaseUrl}/api/app/3isk/video.mp4?url=${encodeURIComponent(m.watchUrl)}${keyParam}`,
        hls_stream_url: `${effectiveBaseUrl}/api/app/3isk/stream?url=${encodeURIComponent(m.watchUrl)}${keyParam}`,
      };
    });

    // Filter by type
    if (type === 'SERIES') movies = [];
    if (type === 'MOVIE') series = [];

    // Filter by search query
    if (q) {
      const query = q.toLowerCase();
      series = series.filter((s) => s.title.toLowerCase().includes(query) || s.description.toLowerCase().includes(query));
      movies = movies.filter((m) => m.title.toLowerCase().includes(query) || m.description.toLowerCase().includes(query));
    }

    // Filter by category
    if (category) {
      const catLow = category.toLowerCase();
      series = series.filter((s) => s.category.toLowerCase().includes(catLow));
      movies = movies.filter((m) => m.category.toLowerCase().includes(catLow));
    }

    reply.header('Cache-Control', 'public, max-age=60');
    reply.header('Access-Control-Allow-Origin', '*');

    return {
      success: true,
      section: 'قصة عشق (3isk Drama & Movies)',
      source: 'https://3iskk.xyz',
      updated_at: catalog.updatedAt,
      total_series: series.length,
      total_movies: movies.length,
      series,
      movies,
    };
  });

  /**
   * Helper to proxy and rewrite m3u8 playlists for 3isk
   */
  async function proxy3iskM3u8(targetUrl: string, request: FastifyRequest, reply: FastifyReply) {
    const settings = await settingsRepository.getSettings();
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = settings.publicStreamBaseUrl;
    if ((!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) && reqHost && !reqHost.includes('127.0.0.1')) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }
    if (!effectiveBaseUrl) {
      effectiveBaseUrl = 'https://aspreen-tv-production.up.railway.app';
    }

    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const upstreamRes = await fetch(targetUrl, {
      headers: { 'User-Agent': ua, 'Referer': 'https://miravd.com/' },
      signal: AbortSignal.timeout(12000),
    });

    if (!upstreamRes.ok) {
      streamCache.clear();
      return reply.status(upstreamRes.status).send({ error: 'Upstream m3u8 fetch failed' });
    }

    const rawText = await upstreamRes.text();
    const baseUri = targetUrl;
    const lines = rawText.split('\n');

    const rewritten = lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Handle URI attributes in tags (e.g. #EXT-X-KEY:METHOD=AES-128,URI="...")
        if (trimmed.startsWith('#')) {
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
              const fullUri = new URL(uri, baseUri).href;
              if (fullUri.toLowerCase().includes('.m3u8')) {
                return `URI="${effectiveBaseUrl}/api/app/3isk/stream?url=${encodeURIComponent(fullUri)}"`;
              }
              return `URI="${effectiveBaseUrl}/api/app/3isk/ts-proxy?url=${encodeURIComponent(fullUri)}"`;
            });
          }
          return line;
        }

        // Segment or sub-playlist URL
        const absoluteUrl = new URL(trimmed, baseUri).href;
        if (absoluteUrl.toLowerCase().includes('.m3u8')) {
          return `${effectiveBaseUrl}/api/app/3isk/stream?url=${encodeURIComponent(absoluteUrl)}`;
        }
        return `${effectiveBaseUrl}/api/app/3isk/ts-proxy?url=${encodeURIComponent(absoluteUrl)}`;
      })
      .join('\n');

    reply.header('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Cache-Control', 'public, max-age=1800');

    return reply.send(rewritten);
  }

  /**
   * GET /api/app/3isk/video.mp4?url=...
   * Remuxes HLS live/VOD stream to progressive fragmented MP4 in real-time using FFmpeg
   * Plays natively on all browsers and devices with zero HLS key or buffering errors!
   */
  server.options('/video.mp4', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    reply.header('Access-Control-Allow-Headers', '*');
    return reply.status(204).send();
  });

  server.get('/video.mp4', async (request: FastifyRequest<{ Querystring: { url: string; api_key?: string } }>, reply: FastifyReply) => {
    const rawUrl = request.query.url;
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      reply.raw.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      reply.raw.end('Missing or invalid url parameter');
      return;
    }

    let targetM3u8 = rawUrl;
    try {
      if (!rawUrl.includes('.m3u8')) {
        targetM3u8 = await resolve3iskStream(rawUrl);
      }
    } catch (err: any) {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        reply.raw.end(`Stream resolution failed: ${err.message}`);
      }
      return;
    }

    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-headers', `Referer: https://miravd.com/\r\nUser-Agent: ${ua}\r\n`,
      '-i', targetM3u8,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1',
    ];

    const proc = spawn('ffmpeg', ffmpegArgs, { windowsHide: true });
    let headersSent = false;

    proc.stdout.on('data', (chunk) => {
      if (!headersSent && !reply.raw.headersSent) {
        headersSent = true;
        reply.raw.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'public, max-age=86400',
          'Connection': 'keep-alive',
        });
      }
      reply.raw.write(chunk);
    });

    const cleanup = () => {
      try {
        proc.kill('SIGTERM');
      } catch {}
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    proc.on('close', () => {
      if (!headersSent && !reply.raw.headersSent) {
        reply.raw.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        reply.raw.end('FFmpeg stream remuxing failed to produce video');
      } else {
        try {
          reply.raw.end();
        } catch {}
      }
    });

    proc.on('error', (err) => {
      cleanup();
      if (!headersSent && !reply.raw.headersSent) {
        reply.raw.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        reply.raw.end(`FFmpeg error: ${err.message}`);
      }
    });
  });

  /**
   * GET /api/app/3isk/stream?url=...
   * Seamlessly resolves and proxies HLS master & variant m3u8 playlists
   */
  server.get('/stream', async (request: FastifyRequest<{ Querystring: { url: string } }>, reply: FastifyReply) => {
    const rawUrl = request.query.url;
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      return reply.status(400).send({ error: 'Missing or invalid url parameter' });
    }

    try {
      let targetM3u8 = rawUrl;
      if (!rawUrl.includes('.m3u8')) {
        targetM3u8 = await resolve3iskStream(rawUrl);
      }
      return await proxy3iskM3u8(targetM3u8, request, reply);
    } catch (err: any) {
      return reply.status(502).send({
        error: 'Stream Resolution Failed',
        message: err.message,
      });
    }
  });

  server.options('/ts-proxy', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type, Origin');
    reply.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    return reply.status(204).send();
  });

  /**
   * GET /api/app/3isk/ts-proxy?url=...
   * High-speed proxy for segments and AES-128 keys without blocking referer
   */
  server.get(
    '/ts-proxy',
    async (request: FastifyRequest<{ Querystring: { url: string } }>, reply: FastifyReply) => {
      const chunkUrl = request.query.url;
      if (!chunkUrl || !/^https?:\/\//i.test(chunkUrl)) {
        return reply.status(400).send({ error: 'Missing or invalid url parameter' });
      }

      const clientRange = request.headers.range;
      const parsedUrl = new URL(chunkUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const upstreamHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://miravd.com/',
      };

      if (clientRange) {
        upstreamHeaders['Range'] = clientRange;
      }

      return new Promise<void>((resolve) => {
        const req = client.request(
          chunkUrl,
          {
            method: 'GET',
            headers: upstreamHeaders,
            agent: isHttps ? httpsAgent : httpAgent,
            timeout: 25000,
          },
          (res) => {
            reply.raw.statusCode = res.statusCode || 200;

            reply.raw.setHeader('Access-Control-Allow-Origin', '*');
            reply.raw.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type');
            reply.raw.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
            reply.raw.setHeader('Accept-Ranges', 'bytes');

            let contentType = res.headers['content-type'] || 'video/mp2t';
            if (chunkUrl.includes('.key')) {
              contentType = 'application/octet-stream';
            } else if (chunkUrl.includes('.ts')) {
              contentType = 'video/mp2t';
            }
            reply.raw.setHeader('Content-Type', contentType);

            if (res.headers['content-length']) {
              reply.raw.setHeader('Content-Length', res.headers['content-length']);
            }
            if (res.headers['content-range']) {
              reply.raw.setHeader('Content-Range', res.headers['content-range']);
            }
            reply.raw.setHeader('Cache-Control', 'public, max-age=86400');

            const sendRawError = (statusCode: number, msg: string) => {
              if (!reply.raw.headersSent) {
                try {
                  reply.raw.writeHead(statusCode, {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*',
                  });
                  reply.raw.end(msg);
                } catch {}
              }
            };

            res.pipe(reply.raw);
            res.on('end', () => resolve());
            res.on('error', (err) => {
              sendRawError(502, err.message);
              resolve();
            });
          }
        );

        const sendReqError = (statusCode: number, msg: string) => {
          if (!reply.raw.headersSent) {
            try {
              reply.raw.writeHead(statusCode, {
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*',
              });
              reply.raw.end(msg);
            } catch {}
          }
        };

        req.on('error', (err) => {
          sendReqError(502, err.message);
          resolve();
        });

        req.on('timeout', () => {
          req.destroy();
          sendReqError(504, 'Chunk request timed out');
          resolve();
        });

        req.end();
      });
    }
  );

  /**
   * GET /api/app/3isk/resolve?url=...
   * Returns JSON payload with the resolved stream URL
   */
  server.get('/resolve', async (request: FastifyRequest<{ Querystring: { url: string } }>, reply) => {
    const watchUrl = request.query.url;
    if (!watchUrl || !/^https?:\/\//i.test(watchUrl)) {
      return reply.status(400).send({ error: 'Missing or invalid url parameter' });
    }

    try {
      const directStreamUrl = await resolve3iskStream(watchUrl);
      reply.header('Access-Control-Allow-Origin', '*');
      return {
        success: true,
        source_url: watchUrl,
        stream_url: directStreamUrl,
      };
    } catch (err: any) {
      return reply.status(502).send({
        success: false,
        error: err.message,
      });
    }
  });
}
