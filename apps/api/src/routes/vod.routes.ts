import https from 'https';
import http from 'http';
import { spawn } from 'child_process';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { vodRepository } from '../repositories/vod.repository';
import { vodService } from '../services/vod.service';
import { topCinemaService } from '../services/topcinema.service';
import { fiveTvService, isDeadOrBrokenHost } from '../services/fivetv.service';
import { streamResolverService } from '../services/stream-resolver.service';

export function getProperReferer(url: string, explicitReferer?: string): string {
  if (explicitReferer) return explicitReferer;
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname.includes('cdn-video.xyz') ||
      parsed.hostname.includes('vidtube') ||
      parsed.hostname.includes('videotube')
    ) {
      return 'https://down.vidtube.one/';
    }
    if (
      parsed.hostname.includes('morencius') ||
      parsed.hostname.includes('minochinos') ||
      parsed.hostname.includes('callistanise') ||
      parsed.hostname.includes('ult4vid') ||
      parsed.hostname.includes('dramiyos') ||
      parsed.hostname.includes('acek-cdn')
    ) {
      return 'https://new61.5tv.lol/';
    }
    if (parsed.hostname.includes('streamtape')) {
      return 'https://streamtape.cc/';
    }
    return `${parsed.protocol}//${parsed.hostname}/`;
  } catch {
    return 'https://web.topcinema.io/';
  }
}

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
   * POST /api/vod/purge
   * Cleans all dead, expired, and broken stream links (gamescdn, invalid domains)
   */
  server.post('/purge', async () => {
    const report = await vodRepository.purgeInvalidStreams();
    return {
      success: true,
      report,
    };
  });

  /**
   * POST /api/vod/reset
   * Wipes movies & series completely and runs fresh A-to-Z scraper in the background
   */
  server.post('/reset', async () => {
    const wipeReport = await vodRepository.wipeAllVod();
    // Trigger fresh full sync in background with gentle staggering
    Promise.resolve().then(async () => {
      try {
        console.log('[VOD] Library wiped, starting gentle fresh sync from FiveTV & TopCinema...');
        await fiveTvService.scrapeMovies(5);
        await new Promise(r => setTimeout(r, 2000));
        await topCinemaService.scrapeRecent(30);
        await new Promise(r => setTimeout(r, 2000));
        await fiveTvService.scrapeSeries(5, 15);
        console.log('[VOD] Gentle fresh sync completed!');
      } catch (err: any) {
        console.error('[VOD] Fresh sync error:', err?.message || err);
      }
    });

    return {
      success: true,
      message: 'تم تنظيف المكتبة بالكامل وبدء سحب روابط الأفلام والمسلسلات الجديدة 100% في الخلفية.',
      wiped: wipeReport,
    };
  });

  /**
   * POST /api/vod/purge-dead
   * Heals movies with alternate servers and purges all completely dead links
   */
  server.post('/purge-dead', async () => {
    const report = await vodRepository.healAndPurgeDeadVod();
    return {
      success: true,
      message: `تم تنظيف الروابط المعطلة بنجاح: تم إصلاح ${report.moviesHealed} فيلم، وحذف ${report.moviesDeleted} فيلم و ${report.episodesDeleted} حلقة معطلة.`,
      report,
    };
  });

  /**
   * POST /api/vod/topcinema-sync
   * Dedicated TopCinema crawler trigger (Runs safely in background)
   */
  server.post(
    '/topcinema-sync',
    async (
      request: FastifyRequest<{
        Body?: { maxMoviePages?: number; maxSeries?: number; recentLimit?: number };
      }>,
      reply
    ) => {
      const { maxMoviePages, maxSeries, recentLimit } = request.body || {};
      Promise.resolve().then(async () => {
        try {
          console.log('[TopCinema] Manual background sync started...');
          await topCinemaService.syncTopCinema({
            maxMoviePages: maxMoviePages || 8,
            maxSeries: maxSeries || 30,
            recentLimit: recentLimit || 50,
          });
          console.log('[TopCinema] Manual background sync finished!');
        } catch (err: any) {
          console.error('[TopCinema] Manual sync error:', err.message);
        }
      });

      return reply.send({
        success: true,
        message: '🎬 بدأ سحب مكتبة TopCinema في الخلفية بأمان! جاري استخراج روابط الفيديو المباشرة.',
      });
    }
  );

  /**
   * POST /api/vod/fivetv-sync
   * Dedicated FiveTV crawler trigger (Runs safely in background)
   */
  server.post(
    '/fivetv-sync',
    async (
      request: FastifyRequest<{
        Body?: { maxMoviePages?: number; maxSeriesPages?: number; recentLimit?: number; deep?: boolean };
      }>,
      reply
    ) => {
      const { maxMoviePages, maxSeriesPages, recentLimit, deep } = request.body || {};
      Promise.resolve().then(async () => {
        try {
          console.log('[FiveTV] Manual background sync started...');
          await fiveTvService.syncFiveTv({
            deep: !!deep,
            maxMoviePages: maxMoviePages || (deep ? 15 : 6),
            maxSeriesPages: maxSeriesPages || (deep ? 10 : 4),
            recentLimit: recentLimit || (deep ? 60 : 30),
          });
          console.log('[FiveTV] Manual background sync finished!');
        } catch (err: any) {
          console.error('[FiveTV] Manual sync error:', err.message);
        }
      });

      return reply.send({
        success: true,
        message: '📺 بدأ سحب مكتبة FiveTV (1080p) في الخلفية بأمان! جاري استخراج روابط الفيديو المباشرة.',
      });
    }
  );

  /**
   * POST /api/vod/full-sync
   * Deep multi-provider sync across FiveTV and TopCinema (Runs safely in background)
   */
  server.post(
    '/full-sync',
    async (
      request: FastifyRequest<{
        Body?: { deep?: boolean };
      }>,
      reply
    ) => {
      const { deep } = request.body || {};
      Promise.resolve().then(async () => {
        try {
          console.log('[FullSync] Background sync started...');
          await fiveTvService.syncFiveTv({ deep: !!deep });
          await topCinemaService.syncTopCinema({ deep: !!deep });
          console.log('[FullSync] Background sync finished successfully!');
        } catch (err: any) {
          console.error('[FullSync] Background sync error:', err.message);
        }
      });

      return reply.send({
        success: true,
        message: '🚀 بدأت المزامنة الشاملة لجميع المصادر في الخلفية بأمان! جاري سحب الأفلام والمسلسلات وبناء روابط البث المباشر.',
      });
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
          'Referer': getProperReferer(url),
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
            const outHeaders: Record<string, string> = {
              'Content-Type': res.headers['content-type'] || 'video/mp2t',
              'Access-Control-Allow-Origin': '*',
              'Accept-Ranges': 'bytes',
            };
            if (res.headers['content-length']) outHeaders['Content-Length'] = res.headers['content-length'];
            if (res.headers['content-range']) outHeaders['Content-Range'] = res.headers['content-range'];

            reply.raw.writeHead(res.statusCode || 200, outHeaders);
            reply.hijack();

            reply.raw.on('close', () => { req.destroy(); resolve(); });
            reply.raw.on('error', () => { req.destroy(); resolve(); });
            res.pipe(reply.raw);
            res.on('end', () => resolve());
            res.on('error', () => resolve());
          });
          req.on('error', (err) => {
            if (reply.raw.headersSent) resolve();
            else reject(err);
          });
          req.setTimeout(25000, () => {
            req.destroy();
            if (reply.raw.headersSent) resolve();
            else reject(new Error('Timeout fetching stream segment'));
          });
        });
      } catch (err: any) {
        if (!reply.raw.headersSent) {
          console.error('[ProxyStream Error]:', err.message);
          return reply.status(502).send({ error: 'Failed to proxy stream: ' + err.message });
        }
      }
    }
  );

  /**
   * Helper: Relay a video stream with byte-range support (HTTP 206), redirect following, and CORS headers
   */
  /**
   * Check if a presigned Cloudflare R2 / AWS S3 link has expired
   */
  function isPresignedUrlExpired(url: string): boolean {
    try {
      const parsed = new URL(url);
      const amzDate = parsed.searchParams.get('X-Amz-Date');
      const amzExpires = parsed.searchParams.get('X-Amz-Expires');
      if (amzDate && amzExpires) {
        const year = parseInt(amzDate.substring(0, 4), 10);
        const month = parseInt(amzDate.substring(4, 6), 10) - 1;
        const day = parseInt(amzDate.substring(6, 8), 10);
        const hour = parseInt(amzDate.substring(9, 11), 10);
        const min = parseInt(amzDate.substring(11, 13), 10);
        const sec = parseInt(amzDate.substring(13, 15), 10);
        const signedTime = Date.UTC(year, month, day, hour, min, sec);
        const expiryTime = signedTime + parseInt(amzExpires, 10) * 1000;
        return Date.now() > expiryTime;
      }
    } catch {}
    return false;
  }

  /**
   * Helper: Relay a video stream with byte-range support (HTTP 206), redirect following, and fast failover
   */
  async function relayVideoStream(
    targetUrl: string,
    request: FastifyRequest,
    reply: any,
    redirectCount = 0,
    explicitReferer?: string
  ): Promise<void> {
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
      'Referer': getProperReferer(targetUrl, explicitReferer),
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

    // Handle HEAD requests: Cloudflare R2 / S3 presigned URLs reject HEAD with 403 Forbidden.
    // We simulate HEAD using GET with Range: bytes=0-0 to retrieve content headers & total size instantly without downloading the video.
    if (request.method === 'HEAD') {
      headers['Range'] = 'bytes=0-0';
      return new Promise<void>((resolve, reject) => {
        let headersReceived = false;
        const connectTimer = setTimeout(() => {
          if (!headersReceived) {
            req.destroy();
            reject(new Error(`Timeout probing upstream (${parsed.hostname})`));
          }
        }, 6000);

        const req = client.get(targetUrl, { headers, rejectUnauthorized: false }, (res) => {
          headersReceived = true;
          clearTimeout(connectTimer);

          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location;
            if (!nextUrl.startsWith('http')) {
              nextUrl = new URL(nextUrl, targetUrl).toString();
            }
            const nextReferer = targetUrl.includes('streamtape') ? 'https://streamtape.cc/' : (explicitReferer || headers['Referer']);
            return relayVideoStream(nextUrl, request, reply, redirectCount + 1, nextReferer).then(resolve).catch(reject);
          }

          if (res.statusCode && res.statusCode >= 400) {
            res.destroy();
            return reject(new Error(`Upstream server returned HTTP ${res.statusCode}`));
          }

          let totalLength: string | undefined;
          const contentRange = res.headers['content-range'];
          if (contentRange) {
            const match = contentRange.match(/\/(\d+)/);
            if (match) totalLength = match[1];
          }

          const responseHeaders: Record<string, string> = {
            'Content-Type': res.headers['content-type'] || 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Accept, Content-Type',
          };
          if (totalLength) {
            responseHeaders['Content-Length'] = totalLength;
          } else if (res.headers['content-length']) {
            responseHeaders['Content-Length'] = res.headers['content-length'];
          }

          reply.raw.writeHead(200, responseHeaders);
          reply.raw.end();
          reply.hijack();
          res.destroy();
          resolve();
        });

        req.on('error', (err) => {
          clearTimeout(connectTimer);
          if (reply.raw.headersSent) resolve();
          else reject(err);
        });
      });
    }

    // If stream is HLS m3u8
    if (targetUrl.includes('.m3u8') || targetUrl.includes('manifest')) {
      const isM3u8Request = request.url.toLowerCase().includes('.m3u8');

      if (isM3u8Request) {
        const data: Buffer = await new Promise((resolve, reject) => {
          let headersReceived = false;
          const connectTimer = setTimeout(() => {
            if (!headersReceived) {
              req.destroy();
              reject(new Error(`Timeout connecting to m3u8 host (${parsed.hostname})`));
            }
          }, 7000);

          const req = client.get(targetUrl, { headers, rejectUnauthorized: false }, (res) => {
            headersReceived = true;
            clearTimeout(connectTimer);

            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              let nextUrl = res.headers.location;
              if (!nextUrl.startsWith('http')) {
                nextUrl = new URL(nextUrl, targetUrl).toString();
              }
              return relayVideoStream(nextUrl, request, reply, redirectCount + 1, explicitReferer).then(resolve as any).catch(reject);
            }
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
          });

          req.on('error', (err) => {
            clearTimeout(connectTimer);
            reject(err);
          });
        });

        const text = data.toString('utf8');
        if (!text.includes('#EXTM3U')) {
          throw new Error('Upstream host returned invalid or blocked m3u8 playlist');
        }

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
        reply.header('Access-Control-Allow-Origin', '*');
        return reply.send(rewrittenLines.join('\n'));
      }

      // If requested as .mp4 or generic media playback (e.g. VLC, Android TV, IPTV, media players):
      // Dynamically remux upstream HLS playlist to MPEG-TS in real-time using FFmpeg!
      return new Promise<void>((resolve, reject) => {
        let headersSent = false;
        const ffmpegArgs = [
          '-headers', `Referer: ${headers['Referer']}\r\nUser-Agent: ${headers['User-Agent']}\r\n`,
          '-probesize', '32768',
          '-analyzeduration', '0',
          '-i', targetUrl,
          '-c', 'copy',
          '-f', 'mpegts',
          '-flush_packets', '1',
          'pipe:1',
        ];

        const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'ignore'] });

        const cleanup = () => {
          try {
            proc.kill('SIGKILL');
          } catch {}
        };

        reply.raw.on('close', cleanup);
        reply.raw.on('error', cleanup);

        proc.stdout.on('data', (chunk: Buffer) => {
          if (!headersSent) {
            headersSent = true;
            reply.raw.writeHead(200, {
              'Content-Type': 'video/mp2t',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
              'Access-Control-Allow-Headers': 'Range, Accept, Content-Type',
              'Connection': 'keep-alive',
            });
            reply.hijack();
          }
          reply.raw.write(chunk);
        });

        proc.stdout.on('end', () => {
          if (headersSent) reply.raw.end();
          resolve();
        });

        proc.on('error', (err) => {
          cleanup();
          if (headersSent) resolve();
          else reject(err);
        });

        proc.on('close', (code) => {
          if (headersSent) {
            reply.raw.end();
            resolve();
          } else {
            reject(new Error(`FFmpeg exited with code ${code} without sending media headers`));
          }
        });
      });
    }

    // Direct MP4 / binary stream with full Range request (206 Partial Content) support
    return new Promise<void>((resolve, reject) => {
      let headersReceived = false;
      const connectTimer = setTimeout(() => {
        if (!headersReceived) {
          req.destroy();
          reject(new Error(`Timeout connecting to upstream server (${parsed.hostname})`));
        }
      }, 3500); // 3.5s connect timeout for instant failover

      const req = client.get(targetUrl, { headers, rejectUnauthorized: false }, (res) => {
        headersReceived = true;
        clearTimeout(connectTimer);

        // Follow redirects seamlessly
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let nextUrl = res.headers.location;
          if (!nextUrl.startsWith('http')) {
            nextUrl = new URL(nextUrl, targetUrl).toString();
          }
          const nextReferer = targetUrl.includes('streamtape') ? 'https://streamtape.cc/' : (explicitReferer || headers['Referer']);
          return relayVideoStream(nextUrl, request, reply, redirectCount + 1, nextReferer).then(resolve).catch(reject);
        }

        if (res.statusCode && res.statusCode >= 400) {
          res.destroy();
          return reject(new Error(`Upstream server returned HTTP ${res.statusCode}`));
        }

        const rawContentType = (res.headers['content-type'] || '').toLowerCase();
        if (rawContentType.includes('text/html') || rawContentType.includes('text/plain')) {
          res.destroy();
          return reject(new Error(`Upstream returned non-video content (${rawContentType})`));
        }

        const outHeaders: Record<string, string> = {
          'Content-Type': res.headers['content-type'] || 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Accept, Content-Type',
        };
        if (res.headers['content-length']) outHeaders['Content-Length'] = res.headers['content-length'];
        if (res.headers['content-range']) outHeaders['Content-Range'] = res.headers['content-range'];

        reply.raw.writeHead(res.statusCode || 200, outHeaders);
        reply.hijack();

        // Clean up upstream connection if downstream client closes/disconnects
        reply.raw.on('close', () => {
          req.destroy();
          resolve();
        });
        reply.raw.on('error', () => {
          req.destroy();
          resolve();
        });

        res.pipe(reply.raw);
        res.on('end', () => resolve());
        res.on('error', () => resolve());
      });

      req.on('error', (err) => {
        clearTimeout(connectTimer);
        if (reply.raw.headersSent) resolve();
        else reject(err);
      });

      // Stream transfer idle timeout
      req.setTimeout(45000, () => {
        req.destroy();
        if (reply.raw.headersSent) resolve();
        else reject(new Error('Timeout streaming media chunk'));
      });
    });
  }

  /**
   * Helper: Automatically try all available servers in the background and stream the first working one
   * Includes automatic self-healing recovery for movies & series with expired source links
   */
  async function streamWithAutoFallback(
    primaryUrl: string,
    servers: Array<{ name?: string; url: string }> | undefined,
    request: FastifyRequest,
    reply: any,
    metadata?: { id: string; title: string; type: 'movie' | 'episode' }
  ) {
    if (reply.raw.headersSent) return;

    const candidateUrls: string[] = [];
    if (primaryUrl && !isPresignedUrlExpired(primaryUrl) && !isDeadOrBrokenHost(primaryUrl)) {
      candidateUrls.push(primaryUrl);
    }
    if (servers && servers.length > 0) {
      for (const s of servers) {
        if (s.url && !candidateUrls.includes(s.url) && !isPresignedUrlExpired(s.url) && !isDeadOrBrokenHost(s.url)) {
          candidateUrls.push(s.url);
        }
      }
    }

    // Prioritize ultra-reliable, high-speed hosts
    candidateUrls.sort((a, b) => {
      const score = (u: string) => {
        // Direct cloud buckets / MP4 files (Fastest: < 200ms)
        if (
          u.includes('ult4vid') ||
          u.includes('r2.cloudflarestorage') ||
          u.includes('workers.dev') ||
          u.includes('storage.googleapis')
        ) return 0;
        // Fast direct extractors
        if (u.includes('71stream') || u.includes('vidtube') || u.includes('videotube')) return 1;
        // High quality fast HLS hosts
        if (
          u.includes('vidmoly') ||
          u.includes('morencius') ||
          u.includes('minochinos') ||
          u.includes('callistanise') ||
          u.includes('dramiyos') ||
          u.includes('acek-cdn')
        ) return 2;
        if (u.includes('streamtape') || u.includes('ok.ru')) return 3;
        // Deprioritize known slow or problematic hosts
        if (
          u.includes('dsvplay') ||
          u.includes('streamwish') ||
          u.includes('filemoon') ||
          u.includes('dood') ||
          u.includes('vidoza')
        ) return 99;
        return 5;
      };
      return score(a) - score(b);
    });

    for (const url of candidateUrls) {
      if (reply.raw.headersSent) return;
      try {
        let direct = await streamResolverService.resolveDirectStream(url);
        let target = direct.directUrl || url;

        if (isPresignedUrlExpired(target) || target.includes('gamescdn.online')) {
          continue;
        }

        const isTargetValidVideo =
          (direct.directUrl && direct.directUrl !== url) ||
          target.includes('.mp4') ||
          target.includes('.m3u8') ||
          target.includes('manifest') ||
          target.includes('get_video') ||
          target.includes('cloudflarestorage') ||
          target.includes('r2.') ||
          target.includes('workers.dev') ||
          target.includes('storage.googleapis');

        if (isTargetValidVideo) {
          await relayVideoStream(target, request, reply);
          return;
        }
      } catch (err: any) {
        if (reply.raw.headersSent) return;
        console.warn(`[StreamRelay] Server candidate failed (${url.slice(0, 60)}):`, err?.message || err);
      }
    }

    if (reply.raw.headersSent) return;

    // Auto-Recovery: If all candidates failed or were expired, auto-heal by finding fresh watch details on FiveTV
    if (metadata?.title) {
      try {
        console.log(`[StreamRelay] Attempting auto-recovery for ${metadata.type} "${metadata.title}"...`);
        const fresh = await fiveTvService.findFreshWatchDetails(metadata.title);
        if (fresh?.streamUrl) {
          const freshCandidates = [fresh.streamUrl, ...(fresh.servers || []).map(s => s.url)];
          for (const fUrl of freshCandidates) {
            if (reply.raw.headersSent) return;
            try {
              let direct = await streamResolverService.resolveDirectStream(fUrl);
              let target = direct.directUrl || fUrl;
              if (
                direct.directUrl ||
                target.includes('.mp4') ||
                target.includes('.m3u8') ||
                target.includes('cloudflarestorage') ||
                target.includes('r2.')
              ) {
                // Update database in background with the fresh permanent embed & servers
                if (metadata.type === 'movie') {
                  vodRepository.getMovieById(metadata.id).then(m => {
                    if (m) {
                      vodRepository.upsertMovie({
                        ...m,
                        streamUrl: fresh.streamUrl!,
                        servers: fresh.servers,
                      }).catch(() => {});
                    }
                  }).catch(() => {});
                } else if (metadata.type === 'episode') {
                  vodRepository.getEpisodeById(metadata.id).then(ep => {
                    if (ep) {
                      vodRepository.upsertEpisode({
                        ...ep,
                        streamUrl: fresh.streamUrl!,
                        servers: fresh.servers,
                      }).catch(() => {});
                    }
                  }).catch(() => {});
                }
                await relayVideoStream(target, request, reply);
                return;
              }
            } catch (err: any) {
              if (reply.raw.headersSent) return;
              console.warn(`[StreamRelay] Auto-recovery candidate failed (${fUrl.slice(0, 60)}):`, err?.message || err);
            }
          }
        }
      } catch (err: any) {
        if (reply.raw.headersSent) return;
        console.warn(`[StreamRelay] Auto-recovery failed for "${metadata.title}":`, err?.message || err);
      }
    }

    if (reply.raw.headersSent) return;

    // Fallback: Seamless redirect to best candidate or primary URL (supports VLC, Android TV, and Web)
    const fallbackUrl = candidateUrls[0] || primaryUrl || (servers && servers[0]?.url);
    if (fallbackUrl) {
      return reply.redirect(fallbackUrl, 302);
    }

    reply.header('Content-Type', 'application/json');
    return reply.status(404).send(JSON.stringify({ error: 'Stream not found for this item' }));
  }

  /**
   * GET /api/vod/stream/movie/:id
   * GET /api/vod/stream/movie/:id/stream.mp4
   * GET /api/vod/stream/movie/:id/stream.m3u8
   * Pure Direct 1-Click Video Streaming Relay for Movies (Zero servers, zero ads, pure video)
   */
  const handleMovieStream = async (request: FastifyRequest<{ Params: { id: string } }>, reply: any) => {
    const rawId = request.params.id;
    const id = rawId.replace(/\.(mp4|m3u8)$/i, '').replace(/\/stream\.(mp4|m3u8)$/i, '');
    const movie = await vodRepository.getMovieById(id);
    if (!movie) {
      return reply.status(404).send({ error: 'Movie not found' });
    }

    return streamWithAutoFallback(movie.streamUrl, movie.servers, request, reply, {
      id: movie.id,
      title: movie.title,
      type: 'movie',
    });
  };

  server.get('/stream/movie/:id', handleMovieStream);
  server.get('/stream/movie/:id/stream.mp4', handleMovieStream);
  server.get('/stream/movie/:id/stream.m3u8', handleMovieStream);

  /**
   * GET /api/vod/stream/episode/:id
   * GET /api/vod/stream/episode/:id/stream.mp4
   * GET /api/vod/stream/episode/:id/stream.m3u8
   * Pure Direct 1-Click Video Streaming Relay for Series Episodes
   */
  const handleEpisodeStream = async (request: FastifyRequest<{ Params: { id: string } }>, reply: any) => {
    const rawId = request.params.id;
    const id = rawId.replace(/\.(mp4|m3u8)$/i, '').replace(/\/stream\.(mp4|m3u8)$/i, '');
    const episode = await vodRepository.getEpisodeById(id);
    if (!episode) {
      return reply.status(404).send({ error: 'Episode not found' });
    }

    return streamWithAutoFallback(episode.streamUrl, episode.servers, request, reply, {
      id: episode.id,
      title: episode.title,
      type: 'episode',
    });
  };

  server.get('/stream/episode/:id', handleEpisodeStream);
  server.get('/stream/episode/:id/stream.mp4', handleEpisodeStream);
  server.get('/stream/episode/:id/stream.m3u8', handleEpisodeStream);
}

