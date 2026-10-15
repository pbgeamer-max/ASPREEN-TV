import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { settingsRepository } from '../repositories/settings.repository';

// In-memory cache for resolved stream URLs (TTL: 2 hours)
const streamCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Resolves watch page on 3isk to direct HLS master.m3u8
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

  // Step 4: Embed -> ukrcdn
  const embedRes = await fetch(iframeMatch[1], {
    headers: { 'User-Agent': ua, 'Referer': nextUrlMatch[1] },
  });
  const embedHtml = await embedRes.text();
  const cdnMatch = embedHtml.match(/<iframe[^>]+src="([^"]+ukrcdn[^"]+)"/i);
  if (!cdnMatch) {
    throw new Error('CDN player iframe not found in embed');
  }

  // Step 5: ukrcdn -> playback API
  const cdnRes = await fetch(cdnMatch[1], {
    headers: { 'User-Agent': ua, 'Referer': 'https://3iskk.xyz/' },
  });
  const cdnHtml = await cdnRes.text();
  const playbackMatch = cdnHtml.match(/fetch\("([^"]+playback[^"]+)"/i);
  if (!playbackMatch) {
    throw new Error('Playback API URL not found in player');
  }

  const playbackUrl = playbackMatch[1].replace(/\\/g, '');

  // Step 6: Playback API -> master.m3u8
  const playRes = await fetch(playbackUrl, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': ua,
      'Referer': cdnMatch[1],
    },
  });
  const playJson: any = await playRes.json();
  if (!playJson || !playJson.url) {
    throw new Error('Playback API failed to return direct stream');
  }

  const streamUrl = playJson.url;
  // Cache for 2 hours
  streamCache.set(watchPageUrl, {
    url: streamUrl,
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  });

  return streamUrl;
}

export async function iskRoutes(server: FastifyInstance) {
  /**
   * Helper to load catalog from disk
   */
  function loadCatalog(): { series: any[]; movies: any[]; updatedAt: string } {
    const possiblePaths = [
      path.join(process.cwd(), 'data', '3isk_catalog.json'),
      path.join(process.cwd(), '..', '..', 'data', '3isk_catalog.json'),
      path.join(__dirname, '..', '..', 'data', '3isk_catalog.json'),
      '/app/data/3isk_catalog.json',
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch {}
      }
    }

    return { series: [], movies: [], updatedAt: new Date().toISOString() };
  }

  /**
   * GET /api/app/3isk/catalog
   * Returns all Turkish series and movies with posters, stories, and streaming links
   */
  server.get('/catalog', async (request: FastifyRequest<{ Querystring: { type?: string; q?: string; category?: string; api_key?: string } }>, reply) => {
    const { type, q, category } = request.query;
    const catalog = loadCatalog();

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

    // 2. Check API Key if configured
    const configuredKey = (settings.masterApiKey || '').trim();
    const incomingKey = (request.query as any).api_key ||
                        request.headers['x-api-key'] ||
                        (request.headers.authorization ? request.headers.authorization.replace(/^Bearer\s+/i, '') : '');

    const referer = (request.headers.referer || '');
    const isInternalWeb = referer.includes('/3isk') || referer.includes('localhost') || referer.includes('railway.app');

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
        stream_url: `${effectiveBaseUrl}/api/app/3isk/stream?url=${encodeURIComponent(ep.watchUrl)}${keyParam}`,
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
        stream_url: `${effectiveBaseUrl}/api/app/3isk/stream?url=${encodeURIComponent(m.watchUrl)}${keyParam}`,
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
   * GET /api/app/3isk/stream?url=...
   * Resolves and seamlessly redirects to the high-speed HLS master.m3u8 stream with CORS
   */
  server.get('/stream', async (request: FastifyRequest<{ Querystring: { url: string } }>, reply: FastifyReply) => {
    const watchUrl = request.query.url;
    if (!watchUrl || !/^https?:\/\//i.test(watchUrl)) {
      return reply.status(400).send({ error: 'Missing or invalid url parameter' });
    }

    try {
      const directStreamUrl = await resolve3iskStream(watchUrl);
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.redirect(directStreamUrl, 302);
    } catch (err: any) {
      return reply.status(502).send({
        error: 'Stream Resolution Failed',
        message: err.message,
      });
    }
  });

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
