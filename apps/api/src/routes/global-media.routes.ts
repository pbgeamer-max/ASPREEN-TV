import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalMediaService } from '../services/global-media.service';
import { directStreamService } from '../services/direct-stream.service';
import { settingsRepository } from '../repositories/settings.repository';
import * as http from 'http';
import * as https from 'https';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 150, maxFreeSockets: 30, timeout: 30000 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 150, maxFreeSockets: 30, timeout: 30000 });

export async function globalMediaRoutes(server: FastifyInstance) {
  function getEffectiveBaseUrl(request: FastifyRequest, settings: any): string {
    const reqHost = (request.headers['x-forwarded-host'] as string) || (request.headers.host as string);
    const reqProto = (request.headers['x-forwarded-proto'] as string) || 'https';
    let effectiveBaseUrl = settings?.publicStreamBaseUrl;
    if (
      (!effectiveBaseUrl || effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('@')) &&
      reqHost &&
      !reqHost.includes('127.0.0.1')
    ) {
      effectiveBaseUrl = `${reqProto}://${reqHost}`;
    }
    if (!effectiveBaseUrl) {
      effectiveBaseUrl = 'https://aspreen-tv-production.up.railway.app';
    }
    return effectiveBaseUrl;
  }

  /**
   * GET /catalog
   * Worldwide Movies & Series catalog with Country and Genre filtering (excluding Turkey)
   */
  server.get(
    '/catalog',
    async (
      request: FastifyRequest<{
        Querystring: {
          page?: string;
          type?: 'all' | 'movie' | 'tv' | 'anime';
          country?: string;
          genre?: string;
          order?: string;
          q?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const page = parseInt(request.query.page || '1', 10) || 1;
      const type = request.query.type || 'all';
      const country = request.query.country || 'ALL';
      const genre = request.query.genre || 'ALL';
      const order = request.query.order || 'popularity.desc';
      const q = (request.query.q || '').trim();

      try {
        const result = await globalMediaService.getCatalog({
          page,
          type,
          country,
          genre,
          order,
          q,
        });

        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Cache-Control', 'public, max-age=180');

        return {
          success: true,
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          total_pages: result.total_pages,
          items: result.items,
        };
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: err.message,
        });
      }
    }
  );

  /**
   * GET /details/:id
   * Details, seasons, and episodes for a movie or TV show
   */
  server.get(
    '/details/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { type?: 'movie' | 'tv'; season?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tmdbId = request.params.id;
      const type = request.query.type || 'tv';
      const season = parseInt(request.query.season || '1', 10) || 1;

      try {
        const settings = await settingsRepository.getSettings().catch(() => ({}));
        const baseUrl = getEffectiveBaseUrl(request, settings);

        const details = await globalMediaService.getDetails(tmdbId, type, season, baseUrl);

        if (!details) {
          return reply.status(404).send({ success: false, error: 'MEDIA_NOT_FOUND' });
        }

        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Cache-Control', 'public, max-age=300');

        return {
          success: true,
          data: details,
        };
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: err.message,
        });
      }
    }
  );

  /**
   * GET /stream
   * Resolves direct MP4 / HLS video link and streams it natively with 206 Partial Content byte-ranges
   */
  server.get(
    '/stream',
    async (
      request: FastifyRequest<{
        Querystring: {
          tmdbId: string;
          type?: 'movie' | 'tv';
          season?: string;
          ep?: string;
          fallback?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tmdbId = request.query.tmdbId;
      const type = request.query.type || 'tv';
      const season = parseInt(request.query.season || '1', 10) || 1;
      const ep = parseInt(request.query.ep || '1', 10) || 1;
      const isMovie = type === 'movie';

      if (!tmdbId) {
        return reply.status(400).send({ error: 'Missing tmdbId parameter' });
      }

      try {
        // Attempt direct stream extraction
        const direct = await directStreamService.getDirectStream({
          tmdbId,
          season,
          episode: ep,
          isMovie,
        });

        if (direct && direct.streamUrl) {
          const directUrl = direct.streamUrl;
          const parsedUrl = new URL(directUrl);
          const isHttps = parsedUrl.protocol === 'https:';
          const client = isHttps ? https : http;

          const upstreamHeaders: Record<string, string> = {
            'User-Agent': UA,
            Referer: direct.headers?.referer || 'https://filmboom.top/',
            Origin: direct.headers?.origin || 'https://filmboom.top',
          };

          const clientRange = request.headers.range;
          if (clientRange) {
            upstreamHeaders['Range'] = clientRange;
          }

          return new Promise<void>((resolve) => {
            const req = client.request(
              directUrl,
              {
                method: 'GET',
                headers: upstreamHeaders,
                agent: isHttps ? httpsAgent : httpAgent,
                timeout: 25000,
              },
              (res) => {
                reply.raw.statusCode = res.statusCode || 200;

                reply.raw.setHeader('Access-Control-Allow-Origin', '*');
                reply.raw.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Ranges, Content-Type, Origin');
                reply.raw.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
                reply.raw.setHeader('Accept-Ranges', 'bytes');

                let contentType = res.headers['content-type'] || 'video/mp4';
                if (directUrl.includes('.mp4')) {
                  contentType = 'video/mp4';
                } else if (directUrl.includes('.m3u8')) {
                  contentType = 'application/vnd.apple.mpegurl';
                }
                reply.raw.setHeader('Content-Type', contentType);

                if (res.headers['content-length']) {
                  reply.raw.setHeader('Content-Length', res.headers['content-length']);
                }
                if (res.headers['content-range']) {
                  reply.raw.setHeader('Content-Range', res.headers['content-range']);
                }
                reply.raw.setHeader('Cache-Control', 'public, max-age=86400');

                res.pipe(reply.raw);
                res.on('end', () => resolve());
                res.on('error', (err) => {
                  if (!reply.raw.headersSent) {
                    reply.status(502).send({ error: err.message });
                  }
                  resolve();
                });
              }
            );

            req.on('error', (err) => {
              if (!reply.raw.headersSent) {
                reply.status(502).send({ error: err.message });
              }
              resolve();
            });

            req.on('timeout', () => {
              req.destroy();
              if (!reply.raw.headersSent) {
                reply.status(504).send({ error: 'Stream request timed out' });
              }
              resolve();
            });

            req.end();
          });
        }

        // Clean embed fallback if direct link extraction not yet ready
        const embedUrl = isMovie
          ? `https://vidlink.pro/movie/${tmdbId}?primaryColor=E50914&secondaryColor=A1A1AA`
          : `https://vidlink.pro/tv/${tmdbId}/${season}/${ep}?primaryColor=E50914&secondaryColor=A1A1AA`;

        return reply.redirect(embedUrl);
      } catch (err: any) {
        console.error('[GlobalStream] stream error:', err.message);
        const fallbackUrl = isMovie
          ? `https://vidlink.pro/movie/${tmdbId}?primaryColor=E50914&secondaryColor=A1A1AA`
          : `https://vidlink.pro/tv/${tmdbId}/${season}/${ep}?primaryColor=E50914&secondaryColor=A1A1AA`;
        return reply.redirect(fallbackUrl);
      }
    }
  );

  /**
   * GET /subtitles
   * Returns subtitles extracted for a movie or TV episode with Arabic prioritized
   */
  server.get(
    '/subtitles',
    async (
      request: FastifyRequest<{
        Querystring: {
          tmdbId: string;
          type?: 'movie' | 'tv';
          season?: string;
          ep?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tmdbId = request.query.tmdbId;
      const type = request.query.type || 'tv';
      const season = parseInt(request.query.season || '1', 10) || 1;
      const ep = parseInt(request.query.ep || '1', 10) || 1;
      const isMovie = type === 'movie';

      if (!tmdbId) {
        return reply.status(400).send({ error: 'Missing tmdbId parameter' });
      }

      try {
        const direct = await directStreamService.getDirectStream({
          tmdbId,
          season,
          episode: ep,
          isMovie,
        });

        const settings = await settingsRepository.getSettings().catch(() => ({}));
        const baseUrl = getEffectiveBaseUrl(request, settings);

        const rawSubs = direct?.subtitles || [];
        const tracks = rawSubs.map((sub, idx) => ({
          src: sub.url,
          vtt_url: `${baseUrl}/api/app/global/sub-vtt?url=${encodeURIComponent(sub.url)}`,
          label: sub.language,
          land: sub.isArabic ? 'ar' : 'sub',
          default: idx === 0 && sub.isArabic,
        }));

        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Cache-Control', 'public, max-age=3600');

        return {
          success: true,
          tmdb_id: tmdbId,
          tracks,
        };
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message, tracks: [] });
      }
    }
  );

  /**
   * GET /sub-vtt?url=...
   * Fetches upstream SRT and converts to clean WebVTT format with UTF-8 encoding & CORS
   */
  server.get(
    '/sub-vtt',
    async (
      request: FastifyRequest<{
        Querystring: { url: string };
      }>,
      reply: FastifyReply
    ) => {
      const targetUrl = request.query.url;
      if (!targetUrl) {
        return reply.status(400).send({ error: 'Missing url parameter' });
      }

      try {
        const subRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': UA,
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!subRes.ok) {
          return reply.status(subRes.status).send({ error: 'Failed to fetch upstream subtitle' });
        }

        const rawText = await subRes.text();

        // Check if already WebVTT
        if (rawText.trim().startsWith('WEBVTT')) {
          reply.header('Access-Control-Allow-Origin', '*');
          reply.header('Content-Type', 'text/vtt; charset=utf-8');
          reply.header('Cache-Control', 'public, max-age=86400');
          return reply.send(rawText);
        }

        // Convert SRT to WebVTT format
        let vtt = 'WEBVTT\n\n' + rawText.replace(/\r\n|\r/g, '\n').trim();
        // Replace SRT comma millisecond separators with dots (00:01:23,456 -> 00:01:23.456)
        vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Content-Type', 'text/vtt; charset=utf-8');
        reply.header('Cache-Control', 'public, max-age=86400');

        return reply.send(vtt);
      } catch (err: any) {
        return reply.status(502).send({ error: 'Subtitle conversion failed', message: err.message });
      }
    }
  );

  /**
   * GET /resolve
   * Resolves direct MP4 url and subtitle information for frontend player
   */
  server.get(
    '/resolve',
    async (
      request: FastifyRequest<{
        Querystring: {
          tmdbId: string;
          type?: 'movie' | 'tv';
          season?: string;
          ep?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tmdbId = request.query.tmdbId;
      const type = request.query.type || 'tv';
      const season = parseInt(request.query.season || '1', 10) || 1;
      const ep = parseInt(request.query.ep || '1', 10) || 1;
      const isMovie = type === 'movie';

      if (!tmdbId) {
        return reply.status(400).send({ error: 'Missing tmdbId parameter' });
      }

      try {
        const direct = await directStreamService.getDirectStream({
          tmdbId,
          season,
          episode: ep,
          isMovie,
        });

        const settings = await settingsRepository.getSettings().catch(() => ({}));
        const baseUrl = getEffectiveBaseUrl(request, settings);

        reply.header('Access-Control-Allow-Origin', '*');

        if (direct && direct.streamUrl) {
          const rawSubs = direct.subtitles || [];
          const tracks = rawSubs.map((sub, idx) => ({
            src: sub.url,
            vtt_url: `${baseUrl}/api/app/global/sub-vtt?url=${encodeURIComponent(sub.url)}`,
            label: sub.language,
            land: sub.isArabic ? 'ar' : 'sub',
            default: idx === 0 && sub.isArabic,
          }));

          return {
            success: true,
            isDirectVideo: true,
            streamUrl: `${baseUrl}/api/app/global/stream?tmdbId=${tmdbId}&type=${type}&season=${season}&ep=${ep}`,
            rawStreamUrl: direct.streamUrl,
            quality: direct.quality,
            subtitles: tracks,
          };
        }

        // Clean embed fallback
        const embedUrl = isMovie
          ? `https://vidlink.pro/movie/${tmdbId}?primaryColor=E50914&secondaryColor=A1A1AA`
          : `https://vidlink.pro/tv/${tmdbId}/${season}/${ep}?primaryColor=E50914&secondaryColor=A1A1AA`;

        return {
          success: true,
          isDirectVideo: false,
          streamUrl: embedUrl,
          rawStreamUrl: embedUrl,
          quality: '1080p',
          subtitles: [],
        };
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}
