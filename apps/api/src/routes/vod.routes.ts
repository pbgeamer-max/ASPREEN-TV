import https from 'https';
import http from 'http';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { vodRepository } from '../repositories/vod.repository';
import { vodService } from '../services/vod.service';
import { topCinemaService } from '../services/topcinema.service';
import { fiveTvService } from '../services/fivetv.service';
import { streamResolverService } from '../services/stream-resolver.service';

export async function vodRoutes(server: FastifyInstance) {
  /**
   * GET /api/vod/movies
   * Returns paginated list of movies with category filter & search
   */
  server.get(
    '/movies',
    async (
      request: FastifyRequest<{
        Querystring: { category?: string; q?: string; limit?: string; offset?: string };
      }>
    ) => {
      const { category, q, limit, offset } = request.query;
      const limitNum = limit ? parseInt(limit, 10) : 50;
      const offsetNum = offset ? parseInt(offset, 10) : 0;

      const result = await vodRepository.listMovies(category, q, limitNum, offsetNum);
      const categories = await vodRepository.getDistinctMovieCategories();

      return {
        total: result.total,
        limit: limitNum,
        offset: offsetNum,
        categories,
        items: result.items,
      };
    }
  );

  /**
   * GET /api/vod/series
   * Returns paginated list of TV series with category filter & search
   */
  server.get(
    '/series',
    async (
      request: FastifyRequest<{
        Querystring: { category?: string; q?: string; limit?: string; offset?: string };
      }>
    ) => {
      const { category, q, limit, offset } = request.query;
      const limitNum = limit ? parseInt(limit, 10) : 50;
      const offsetNum = offset ? parseInt(offset, 10) : 0;

      const result = await vodRepository.listSeries(category, q, limitNum, offsetNum);
      const categories = await vodRepository.getDistinctSeriesCategories();

      return {
        total: result.total,
        limit: limitNum,
        offset: offsetNum,
        categories,
        items: result.items,
      };
    }
  );

  /**
   * GET /api/vod/series/:id
   * Returns a single series with all seasons and episodes in order
   */
  server.get('/series/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const { id } = request.params;
    const series = await vodRepository.getSeriesWithEpisodes(id);
    if (!series) {
      return reply.status(404).send({ error: 'Series not found' });
    }
    return series;
  });

  /**
   * GET /api/vod/categories
   * Returns distinct categories for movies and series
   */
  server.get('/categories', async () => {
    const movieCategories = await vodRepository.getDistinctMovieCategories();
    const seriesCategories = await vodRepository.getDistinctSeriesCategories();
    return {
      movieCategories,
      seriesCategories,
    };
  });

  /**
   * POST /api/vod/sync
   * Runs the VOD scraper engine to sync movies and series without duplicates
   */
  server.post('/sync', async () => {
    const report = await vodService.syncAllVod();
    return {
      success: true,
      report,
    };
  });

  /**
   * POST /api/vod/topcinema-sync
   * Dedicated TopCinema crawler trigger
   */
  server.post(
    '/topcinema-sync',
    async (
      request: FastifyRequest<{
        Body?: { maxMoviePages?: number; maxSeries?: number; recentLimit?: number };
      }>
    ) => {
      const { maxMoviePages, maxSeries, recentLimit } = request.body || {};
      const report = await topCinemaService.syncTopCinema({
        maxMoviePages: maxMoviePages || 8,
        maxSeries: maxSeries || 30,
        recentLimit: recentLimit || 50,
      });
      return {
        success: true,
        report,
      };
    }
  );

  /**
   * POST /api/vod/fivetv-sync
   * Dedicated FiveTV crawler trigger
   */
  server.post(
    '/fivetv-sync',
    async (
      request: FastifyRequest<{
        Body?: { maxMoviePages?: number; maxSeriesPages?: number; recentLimit?: number; deep?: boolean };
      }>
    ) => {
      const { maxMoviePages, maxSeriesPages, recentLimit, deep } = request.body || {};
      const report = await fiveTvService.syncFiveTv({
        deep: !!deep,
        maxMoviePages: maxMoviePages || (deep ? 15 : 6),
        maxSeriesPages: maxSeriesPages || (deep ? 10 : 4),
        recentLimit: recentLimit || (deep ? 60 : 30),
      });
      return {
        success: true,
        report,
      };
    }
  );

  /**
   * POST /api/vod/full-sync
   * Deep multi-provider sync across FiveTV and TopCinema
   */
  server.post(
    '/full-sync',
    async (
      request: FastifyRequest<{
        Body?: { deep?: boolean };
      }>
    ) => {
      const { deep } = request.body || {};
      const fivetvReport = await fiveTvService.syncFiveTv({ deep: !!deep });
      const topcinemaReport = await topCinemaService.syncTopCinema({ deep: !!deep });
      const stats = await vodRepository.getStats();

      return {
        success: true,
        report: {
          fivetv: fivetvReport,
          topcinema: topcinemaReport,
          totalMovies: stats.totalMovies,
          totalSeries: stats.totalSeries,
          totalEpisodes: stats.totalEpisodes,
        },
      };
    }
  );

  /**
   * POST /api/vod/deep-sync
   * True unlimited background crawl from A to Z across all pages of FiveTV & TopCinema
   */
  server.post(
    '/deep-sync',
    async (request: FastifyRequest<{ Body?: { unlimited?: boolean } }>, reply) => {
      // First clean any bad links in background
      vodRepository.purgeInvalidStreams().then(async (cleanRes) => {
        console.log(`[DeepSync] Cleaned invalid links: ${cleanRes.moviesDeleted} movies, ${cleanRes.episodesDeleted} episodes`);
        console.log('[DeepSync] Starting unlimited FiveTV crawl...');
        await fiveTvService.syncFiveTv({ unlimited: true });
        console.log('[DeepSync] Starting unlimited TopCinema crawl...');
        await topCinemaService.syncTopCinema({ unlimited: true });
        console.log('[DeepSync] Completed full deep ingestion!');
      }).catch(err => {
        console.error('[DeepSync] Error during background ingestion:', err.message);
      });

      return reply.send({
        success: true,
        message: '🚀 بدأ سحب المكتبات بالكامل من الألف إلى الياء في الخلفية (بدون حدود صفحات)! يتم استخراج روابط التشغيل النظيفة فقط وحذف روابط المواقع.',
      });
    }
  );

  /**
   * POST /api/vod/clean
   * Delete any broken or website-page stream links so they get re-ingested cleanly
   */
  server.post('/clean', async () => {
    const result = await vodRepository.purgeInvalidStreams();
    return {
      success: true,
      result,
    };
  });

  /**
   * POST /api/vod/wipe
   * Completely wipe movies and series library to start a 100% fresh clean ingestion
   */
  server.post('/wipe', async () => {
    const result = await vodRepository.wipeAllVod();
    return {
      success: true,
      result,
      message: 'تم تصفير ومسح مكتبة الأفلام والمسلسلات بالكامل بنجاح.',
    };
  });

  /**
   * GET /api/vod/resolve-stream
   * Resolve embed URLs (like 71stream) to direct media file for direct HTML5 player
   */
  server.get(
    '/resolve-stream',
    async (request: FastifyRequest<{ Querystring: { url: string } }>, reply) => {
      const { url } = request.query;
      if (!url) {
        return reply.status(400).send({ error: 'URL parameter is required' });
      }

      const resolved = await streamResolverService.resolveDirectStream(url);
      if (resolved.directUrl) {
        return {
          directUrl: resolved.directUrl,
          title: resolved.title,
        };
      }

      return { directUrl: url };
    }
  );

  /**
   * GET /api/vod/stats
   * Returns current VOD stats
   */
  server.get('/stats', async () => {
    return await vodRepository.getStats();
  });

  /**
   * GET /api/vod/proxy-stream
   * High-performance CORS proxy for HLS (.m3u8) manifests and video segments
   */
  server.get(
    '/proxy-stream',
    async (request: FastifyRequest<{ Querystring: { url: string } }>, reply) => {
      const { url } = request.query;
      if (!url) {
        return reply.status(400).send({ error: 'URL parameter is required' });
      }

      try {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const client = isHttps ? https : http;

        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        reply.header('Access-Control-Allow-Headers', '*');

        const headers: Record<string, string> = {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `${parsed.protocol}//${parsed.hostname}/`,
        };
        if (request.headers.range) {
          headers['Range'] = request.headers.range;
        }

        const isM3u8 = url.includes('.m3u8') || url.includes('manifest');

        if (isM3u8) {
          const data: Buffer = await new Promise((resolve, reject) => {
            const req = client.get(url, { headers, rejectUnauthorized: false }, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => resolve(Buffer.concat(chunks)));
            });
            req.on('error', reject);
            req.setTimeout(12000, () => {
              req.destroy();
              reject(new Error('Timeout fetching m3u8'));
            });
          });

          const text = data.toString('utf8');
          const baseUrl = url;

          const rewrittenLines = text.split('\n').map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line;
            try {
              const absUrl = new URL(trimmed, baseUrl).toString();
              return `/api/vod/proxy-stream?url=${encodeURIComponent(absUrl)}`;
            } catch {
              return line;
            }
          });

          reply.header('Content-Type', 'application/vnd.apple.mpegurl');
          return reply.send(rewrittenLines.join('\n'));
        }

        // For .ts segments or direct media chunks
        return new Promise<void>((resolve, reject) => {
          const req = client.get(url, { headers, rejectUnauthorized: false }, (res) => {
            reply.status(res.statusCode || 200);
            if (res.headers['content-type']) reply.header('Content-Type', res.headers['content-type']);
            if (res.headers['content-length']) reply.header('Content-Length', res.headers['content-length']);
            if (res.headers['content-range']) reply.header('Content-Range', res.headers['content-range']);
            if (res.headers['accept-ranges']) reply.header('Accept-Ranges', res.headers['accept-ranges']);
            res.pipe(reply.raw);
            res.on('end', () => resolve());
            res.on('error', (err) => reject(err));
          });
          req.on('error', (err) => reject(err));
          req.setTimeout(20000, () => {
            req.destroy();
            reject(new Error('Timeout fetching stream segment'));
          });
        });
      } catch (err: any) {
        console.error('[ProxyStream Error]:', err.message);
        return reply.status(502).send({ error: 'Failed to proxy stream: ' + err.message });
      }
    }
  );

  /**
   * Helper: Relay a video stream with byte-range support (HTTP 206), redirect following, and CORS headers
   */
  async function relayVideoStream(targetUrl: string, request: FastifyRequest, reply: any, redirectCount = 0): Promise<void> {
    if (redirectCount > 5) {
      throw new Error('Too many redirects while relaying stream');
    }

    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': `${parsed.protocol}//${parsed.hostname}/`,
    };
    if (request.headers.range) {
      headers['Range'] = request.headers.range;
    }

    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Range, Accept, Content-Type');
    reply.header('Accept-Ranges', 'bytes');

    if (request.method === 'OPTIONS') {
      return reply.status(204).send();
    }

    // If stream is HLS m3u8
    if (targetUrl.includes('.m3u8') || targetUrl.includes('manifest')) {
      const data: Buffer = await new Promise((resolve, reject) => {
        const req = client.get(targetUrl, { headers, rejectUnauthorized: false }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location;
            if (!nextUrl.startsWith('http')) {
              nextUrl = new URL(nextUrl, targetUrl).toString();
            }
            return relayVideoStream(nextUrl, request, reply, redirectCount + 1).then(resolve as any).catch(reject);
          }
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(12000, () => {
          req.destroy();
          reject(new Error('Timeout fetching m3u8'));
        });
      });

      const text = data.toString('utf8');
      const rewrittenLines = text.split('\n').map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        try {
          const absUrl = new URL(trimmed, targetUrl).toString();
          return `/api/vod/proxy-stream?url=${encodeURIComponent(absUrl)}`;
        } catch {
          return line;
        }
      });

      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      return reply.send(rewrittenLines.join('\n'));
    }

    // Direct MP4 / binary stream with full Range request (206 Partial Content) support
    return new Promise<void>((resolve, reject) => {
      const req = client.get(targetUrl, { headers, rejectUnauthorized: false }, (res) => {
        // Follow redirects seamlessly
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let nextUrl = res.headers.location;
          if (!nextUrl.startsWith('http')) {
            nextUrl = new URL(nextUrl, targetUrl).toString();
          }
          return relayVideoStream(nextUrl, request, reply, redirectCount + 1).then(resolve).catch(reject);
        }

        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`Upstream server returned HTTP ${res.statusCode}`));
        }

        reply.status(res.statusCode || 200);
        if (res.headers['content-type']) reply.header('Content-Type', res.headers['content-type']);
        else reply.header('Content-Type', 'video/mp4');
        if (res.headers['content-length']) reply.header('Content-Length', res.headers['content-length']);
        if (res.headers['content-range']) reply.header('Content-Range', res.headers['content-range']);
        if (res.headers['accept-ranges']) reply.header('Accept-Ranges', res.headers['accept-ranges']);
        res.pipe(reply.raw);
        res.on('end', () => resolve());
        res.on('error', (err) => reject(err));
      });
      req.on('error', (err) => reject(err));
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Timeout streaming media'));
      });
    });
  }

  /**
   * Helper: Automatically try all available servers in the background and stream the first working one
   */
  async function streamWithAutoFallback(
    primaryUrl: string,
    servers: Array<{ name?: string; url: string }> | undefined,
    request: FastifyRequest,
    reply: any
  ) {
    const candidateUrls: string[] = [];
    if (primaryUrl) candidateUrls.push(primaryUrl);
    if (servers && servers.length > 0) {
      for (const s of servers) {
        if (s.url && !candidateUrls.includes(s.url)) {
          candidateUrls.push(s.url);
        }
      }
    }

    for (const url of candidateUrls) {
      try {
        let direct = await streamResolverService.resolveDirectStream(url);
        let target = direct.directUrl || url;

        if (
          target.includes('.mp4') ||
          target.includes('.m3u8') ||
          target.includes('manifest') ||
          target.includes('get_video') ||
          target.includes('gamescdn')
        ) {
          await relayVideoStream(target, request, reply);
          return;
        }
      } catch (err: any) {
        console.warn(`[StreamRelay] Server candidate failed (${url}):`, err.message);
      }
    }

    // Fallback: If no candidate could be directly piped, redirect to primary URL
    if (candidateUrls[0]) {
      return reply.redirect(candidateUrls[0]);
    }

    return reply.status(404).send({ error: 'No working stream found for this item' });
  }

  /**
   * GET /api/vod/stream/movie/:id
   * GET /api/vod/stream/movie/:id/stream.mp4
   * Pure Direct 1-Click Video Streaming Relay for Movies (Zero servers, zero ads, pure video)
   */
  const handleMovieStream = async (request: FastifyRequest<{ Params: { id: string } }>, reply: any) => {
    const rawId = request.params.id;
    const id = rawId.replace(/\.mp4$/i, '').replace(/\/stream\.mp4$/i, '');
    const movie = await vodRepository.getMovieById(id);
    if (!movie) {
      return reply.status(404).send({ error: 'Movie not found' });
    }

    return streamWithAutoFallback(movie.streamUrl, movie.servers, request, reply);
  };

  server.get('/stream/movie/:id', handleMovieStream);
  server.get('/stream/movie/:id/stream.mp4', handleMovieStream);

  /**
   * GET /api/vod/stream/episode/:id
   * GET /api/vod/stream/episode/:id/stream.mp4
   * Pure Direct 1-Click Video Streaming Relay for Series Episodes
   */
  const handleEpisodeStream = async (request: FastifyRequest<{ Params: { id: string } }>, reply: any) => {
    const rawId = request.params.id;
    const id = rawId.replace(/\.mp4$/i, '').replace(/\/stream\.mp4$/i, '');
    const episode = await vodRepository.getEpisodeById(id);
    if (!episode) {
      return reply.status(404).send({ error: 'Episode not found' });
    }

    return streamWithAutoFallback(episode.streamUrl, episode.servers, request, reply);
  };

  server.get('/stream/episode/:id', handleEpisodeStream);
  server.get('/stream/episode/:id/stream.mp4', handleEpisodeStream);
}

